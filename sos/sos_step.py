#!/usr/bin/env python3
#
# This file is part of Script of Scripts (sos), a workflow system
# for the execution of commands and scripts in different languages.
# Please visit https://github.com/vatlab/SOS for more information.
#
# Copyright (C) 2016 Bo Peng (bpeng@mdanderson.org)
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.
#
import os
import sys
import copy
import glob
import fnmatch
import pickle

from collections.abc import Sequence, Iterable, Mapping
from itertools import tee, combinations

from .utils import env, AbortExecution, short_repr, stable_repr,\
    get_traceback, transcribe, ActivityNotifier, pickleable
from .pattern import extract_pattern
from .sos_eval import SoS_eval, SoS_exec, Undetermined, param_of
from .target import BaseTarget, FileTarget, dynamic, RuntimeInfo, UnknownTarget, RemovedTarget, UnavailableLock
from .sos_syntax import SOS_INPUT_OPTIONS, SOS_DEPENDS_OPTIONS, SOS_OUTPUT_OPTIONS, \
    SOS_RUNTIME_OPTIONS
from .hosts import Host
from .sos_task import TaskParams

__all__ = []

class StepInfo(object):
    '''A simple class to hold input, output, and index of step. Its attribute can
    only be set using an interface, and cannot be assigned. This is to make sure
    such information is not changed freely by malicious scripts'''
    def __init__(self):
        pass

    def set(self, key, value):
        object.__setattr__(self, key, value)

    def __setattr__(self, key, value):
        raise RuntimeError('Changing of step info {} is prohibited.'.format(key))

    def __repr__(self):
        return '{' + ', '.join('{}: {!r}'.format(x,y) for x,y in self.__dict__.items()) + '}'


def analyze_section(section, default_input=None):
    '''Analyze a section for how it uses input and output, what variables
    it uses, and input, output, etc.'''
    from .sos_executor import __null_func__
    from ._version import __version__
    from .sos_eval import accessed_vars

    # these are the information we need to build a DAG, by default
    # input and output and undetermined, and there are no variables.
    #
    # step input and output can be true "Undetermined", namely unspecified,
    # can be dynamic and has to be determined at run time, or undetermined
    # at this stage because something cannot be determined now.
    step_input = Undetermined()
    step_output = Undetermined()
    step_depends = []
    step_local_input = []
    step_local_output = []
    environ_vars = set()
    signature_vars = set()
    changed_vars = set()
    local_vars = set()
    #
    # 1. execute global definition to get a basic environment
    #
    # FIXME: this could be made much more efficient
    if 'provides' in section.options:
        if '__default_output__' in env.sos_dict:
            step_output = env.sos_dict['__default_output__']
    else:
        #env.sos_dict = WorkflowDict()
        env.sos_dict.set('__null_func__', __null_func__)
        # initial values
        env.sos_dict.set('SOS_VERSION', __version__)
        SoS_exec('import os, sys, glob', None)
        SoS_exec('from sos.runtime import *', None)

    #
    # Here we need to get "contant" values from the global section
    # Because parameters are considered variable, they has to be
    # removed. We achieve this by removing function sos_handle_parameter_
    # from the SoS_dict namespace
    #
    if section.global_def:
        try:
            SoS_exec('del sos_handle_parameter_\n' + section.global_def, section.global_sigil)
        except RuntimeError as e:
            if env.verbosity > 2:
                sys.stderr.write(get_traceback())
            raise RuntimeError('Failed to execute statements\n"{}"\n{}'.format(
                section.global_def, e))
        finally:
            SoS_exec('from sos.runtime import sos_handle_parameter_', None)

    #
    # 2. look for input statement
    if 'shared' in section.options:
        vars = section.options['shared']
        if isinstance(vars, str):
            changed_vars.add(vars)
            vars = {vars: vars}
        elif isinstance(vars, Sequence):
            for item in vars:
                if isinstance(item, str):
                    changed_vars.add(item)
                elif isinstance(item, Mapping):
                    changed_vars |= set(item.keys())
                else:
                    raise ValueError('Option shared should be a string, a mapping of expression, or list of string or mappings. {} provided'.format(vars))
        elif isinstance(vars, Mapping):
            changed_vars |= set(vars.keys())
        else:
            raise ValueError('Option shared should be a string, a mapping of expression, or list of string or mappings. {} provided'.format(vars))


    # look for input statement.
    input_statement_idx = [idx for idx,x in enumerate(section.statements) if x[0] == ':' and x[1] == 'input']
    if not input_statement_idx:
        input_statement_idx = None
    elif len(input_statement_idx) == 1:
        input_statement_idx = input_statement_idx[0]
    else:
        raise RuntimeError('More than one step input are specified in step {}_{}'.format(section.name, section.index))

    # if there is an input statement, analyze the statements before it, and then the input statement
    if input_statement_idx is not None:
        # execute before input stuff
        for statement in section.statements[:input_statement_idx]:
            if statement[0] == '=':
                # we do not get LHS because it must be local to the step
                local_vars |= accessed_vars(statement[1], section.sigil)
                environ_vars |= accessed_vars(statement[2], section.sigil)
            elif statement[0] == ':' and statement[1] != 'depends':
                raise RuntimeError('Step input should be specified before {}'.format(statement[1]))
            else:
                environ_vars |= accessed_vars(statement[1], section.sigil)
        #
        # input statement
        stmt = section.statements[input_statement_idx][2]
        try:
            environ_vars |= accessed_vars(stmt, section.sigil)
            args, kwargs = SoS_eval('__null_func__({})'.format(stmt), section.sigil)
            if not args:
                if default_input is None:
                    step_input = []
                else:
                    step_input = default_input
            elif not any(isinstance(x, dynamic) for x in args):
                step_input = _expand_file_list(True, *args)
            if 'paired_with' in kwargs:
                pw = kwargs['paired_with']
                if pw is None or not pw:
                    pass
                elif isinstance(pw, str):
                    environ_vars.add(pw)
                elif isinstance(pw, Iterable):
                    environ_vars |= set(pw)
                else:
                    raise ValueError('Unacceptable value for parameter paired_with: {}'.format(pw))
            if 'for_each' in kwargs:
                fe = kwargs['for_each']
                if fe is None or not fe:
                    pass
                elif isinstance(fe, str):
                    environ_vars |= set([x.strip() for x in fe.split(',')])
                elif isinstance(fe, Sequence):
                    for fei in fe:
                        environ_vars |= set([x.strip() for x in fei.split(',')])
                else:
                    raise ValueError('Unacceptable value for parameter fe: {}'.format(fe))
        except Exception as e:
            # if anything is not evalutable, keep Undetermined
            env.logger.debug('Input of step {}_{} is set to Undertermined: {}'
                .format(section.name, section.index, e))
            # expression ...
            step_input = Undetermined(stmt)
        input_statement_idx += 1
    else:
        # assuming everything starts from 0 is after input
        input_statement_idx = 0

    # other variables
    for statement in section.statements[input_statement_idx:]:
        # if input is undertermined, we can only process output:
        if statement[0] == '=':
            signature_vars |= accessed_vars('='.join(statement[1:3]), section.sigil)
        elif statement[0] == ':':
            key, value = statement[1:]
            # output, depends, and process can be processed multiple times
            try:
                args, kwargs = SoS_eval('__null_func__({})'.format(value), section.sigil)
                if not any(isinstance(x, dynamic) for x in args):
                    if key == 'output':
                        step_output = _expand_file_list(True, *args)
                    elif key == 'depends':
                        step_depends = _expand_file_list(True, *args)
            except Exception as e:
                env.logger.debug("Args {} cannot be determined: {}".format(value, e))
        else: # statement
            signature_vars |= accessed_vars(statement[1], section.sigil)
            # we also need to check the specification of input and output
            input_param = param_of('input', statement[1])
            for param in input_param:
                try:
                    value = SoS_eval(param, section.sigil)
                    if isinstance(value, str):
                        step_local_input.append(value)
                    elif isinstance(value, Sequence):
                        step_local_input.extend(value)
                    else:
                        step_local_input = Undetermined()
                except Exception as e:
                    env.logger.debug('Args {} of input cannot be determined: {}'.format(param, e))
                    step_local_input = Undetermined()
            #
            output_param = param_of('output', statement[1])
            for param in output_param:
                try:
                    value = SoS_eval(param, section.sigil)
                    if isinstance(value, str):
                        step_local_output.append(value)
                    elif isinstance(value, Sequence):
                        step_local_output.extend(value)
                    else:
                        step_local_output = Undetermined()
                except Exception as e:
                    env.logger.debug('Args {} of input cannot be determined: {}'.format(param, e))
                    step_local_output = Undetermined()
    # finally, tasks..
    if section.task:
        signature_vars |= accessed_vars(section.task, section.sigil)
    return {
        'step_name': '{}_{}'.format(section.name, section.index) if isinstance(section.index, int) else section.name,
        'step_input': step_input,
        'step_output': step_output,
        'step_depends': step_depends,
        'step_local_input': step_local_input,
        'step_local_output': step_local_output,
        # variables starting with __ are internals...
        'environ_vars': {x for x in environ_vars - local_vars if not x.startswith('__')},
        'signature_vars': {x for x in signature_vars if not x.startswith('__')},
        'changed_vars': changed_vars
        }

class Base_Step_Executor:
    # This base class defines how steps are executed. The derived classes will reimplement
    # some function to behave differently in different modes.
    #
    def __init__(self, step):
        self.step = step

    #
    # The following functions should be redefined in an executor
    # because it may behave differently in different modes.
    #
    def expand_input_files(self, value, *args):
        '''Process input files (perhaps a pattern) to determine input files.

        ret:
            Return a file list or Undetermined.
        '''
        raise RuntimeError('Undefined virtual function.')

    def expand_depends_files(self, *args):
        '''Process dependent files (perhaps a pattern) to determine input files.

        ret:
            Return a file list or Undetermined.
        '''
        raise RuntimeError('Undefined virtual function.')

    def expand_output_files(self, value, *args):
        '''Process output files (perhaps a pattern) to determine input files.
        '''
        if any(isinstance(x, dynamic) for x in args):
            return Undetermined(value)
        else:
            return _expand_file_list(True, *args)

    def verify_input(self):
        '''Check if input files exist.'''
        pass

    def verify_output(self):
        '''Check if intended output actually exists.'''
        pass

    def step_signature(self, index):
        '''Base executor does not have signature'''
        return None

    # Nested functions to handle different parameters of input directive
    @staticmethod
    def handle_group_by(ifiles, group_by):
        '''Handle input option group_by'''
        if group_by == 'single':
            return [[x] for x in ifiles]
        elif group_by == 'all':
            # default option
            return [ifiles]
        elif group_by == 'pairs':
            if len(ifiles) % 2 != 0:
                raise ValueError('Paired group_by has to have even number of input files: {} provided'
                    .format(len(ifiles)))
            return list(list(x) for x in zip(ifiles[:len(ifiles)//2], ifiles[len(ifiles)//2:]))
        elif group_by == 'pairwise':
            f1, f2 = tee(ifiles)
            next(f2, None)
            return [list(x) for x in zip(f1, f2)]
        elif group_by == 'combinations':
            return [list(x) for x in combinations(ifiles, 2)]
        elif isinstance(group_by, int) or group_by.isdigit():
            group_by = int(group_by)
            if len(ifiles) % group_by != 0:
                raise ValueError('Size of group_by block has to be divisible by the number of input files: {} provided'
                    .format(len(ifiles)))
            group_by = max(1, group_by)
            return [ifiles[i:i + group_by] for i in range(0, len(ifiles), group_by)]
        else:
            raise ValueError('Unsupported group_by option ``{}``!'.format(group_by))

    @staticmethod
    def handle_paired_with(paired_with, ifiles, _groups, _vars):
        '''Handle input option paired_with'''
        if paired_with is None or not paired_with:
            paired_with = []
        elif isinstance(paired_with, str):
            paired_with = [paired_with]
        elif isinstance(paired_with, Iterable):
            paired_with = list(paired_with)
        else:
            raise ValueError('Unacceptable value for parameter paired_with: {}'.format(paired_with))
        #
        for wv in paired_with:
            if '.' in wv:
                if wv.split('.')[0] not in env.sos_dict:
                    raise ValueError('Variable {} does not exist.'.format(wv))
                values = getattr(env.sos_dict[wv.split('.')[0]], wv.split('.', 1)[-1])
            else:
                if wv not in env.sos_dict:
                    raise ValueError('Variable {} does not exist.'.format(wv))
                values = env.sos_dict[wv]
            if isinstance(values, str) or not isinstance(values, Iterable):
                raise ValueError('with_var variable {} is not a sequence ("{}")'.format(wv, values))
            if len(values) != len(ifiles):
                raise ValueError('Length of variable {} (length {}) should match the number of input files (length {}).'
                    .format(wv, len(values), len(ifiles)))
            file_map = {x:y for x,y in zip(ifiles, values)}
            for idx, grp in enumerate(_groups):
                _vars[idx]['_' + wv.split('.')[0]] = [file_map[x] for x in grp]

    @staticmethod
    def handle_extract_pattern(pattern, ifiles, _groups, _vars):
        '''Handle input option pattern'''
        if pattern is None or not pattern:
            patterns = []
        elif isinstance(pattern, str):
            patterns = [pattern]
        elif isinstance(pattern, Iterable):
            patterns = pattern
        else:
            raise ValueError('Unacceptable value for parameter pattern: {}'.format(pattern))
        #
        for pattern in patterns:
            res = extract_pattern(pattern, ifiles)
            # now, assign the variables to env
            for k, v in res.items():
                if k in ('input', 'output', 'depends') or k.startswith('_'):
                    raise RuntimeError('Pattern defined variable {} is not allowed'.format(k))
                env.sos_dict[k] = v
            # also make k, v pair with _input
            Base_Step_Executor.handle_paired_with(res.keys(), ifiles, _groups, _vars)

    @staticmethod
    def handle_for_each(for_each, _groups, _vars):
        if for_each is None or not for_each:
            for_each = []
        elif isinstance(for_each, (str, dict)):
            for_each = [for_each]
        elif isinstance(for_each, Sequence):
            for_each = for_each
        else:
            raise ValueError('Unacceptable value for parameter for_each: {}'.format(for_each))
        #
        for fe_all in for_each:
            if isinstance(fe_all, dict):
                # in the format of {'name': value}
                fe_iter_names = []
                fe_values = []
                for k, v in fe_all.items():
                    if ',' in k:
                        names = [x.strip() for x in k.split(',')]
                        if any(len(_v) != len(names) for _v in v):
                            raise ValueError('Unable to unpack object {} for variables {} (of length {})'.\
                                             format(short_repr(v), k, len(names)))
                        fe_iter_names.extend(names)
                        fe_values.extend(list(zip(*v)))
                    else:
                        fe_iter_names.append(k)
                        fe_values.append(v)
            else:
                if ',' in fe_all:
                    fe_var_names = [x.strip() for x in fe_all.split(',')]
                    fe_iter_names = ['_' + x for x in fe_var_names]
                else:
                    fe_var_names = [fe_all]
                    fe_iter_names = ['_' + fe_all]
                # check iterator variable name
                for name in fe_iter_names:
                    if '.' in name:
                        raise ValueError('Invalid iterator variable {}'.format(name))
                # check variables
                fe_values = []
                for name in fe_var_names:
                    if name.split('.')[0] not in env.sos_dict:
                        raise ValueError('Variable {} does not exist.'.format(name))
                    if '.' in name:
                        fe_values.append(getattr(env.sos_dict[name.split('.')[0]], name.split('.', 1)[-1]))
                    else:
                        fe_values.append(env.sos_dict[name])

            # get loop size
            loop_size = None
            for name, values in zip(fe_iter_names, fe_values):
                if not isinstance(values, Sequence):
                    try:
                        import pandas as pd
                        if not isinstance(values, pd.DataFrame):
                            raise ValueError('Unacceptable for_each data type {}'.format(values.__class__.__name__))
                    except Exception as e:
                        raise ValueError('Cannot iterate through variable {}: {}'.format(name, e))
                if loop_size is None:
                    loop_size = len(values)
                elif loop_size != len(values):
                    raise ValueError('Length of variable {} (length {}) should match the length of other variables (length {}).'
                        .format(name, len(values), loop_size))
            # expand
            _tmp_groups = copy.deepcopy(_groups)
            _groups.clear()
            for i in range(loop_size):
                _groups.extend(_tmp_groups)
            #
            _tmp_vars = copy.deepcopy(_vars)
            _vars.clear()
            for vidx in range(loop_size):
                for idx in range(len(_tmp_vars)):
                    for var_name, values in zip(fe_iter_names, fe_values):
                        if isinstance(values, Sequence):
                            _tmp_vars[idx][var_name] = values[vidx]
                        elif isinstance(values, pd.DataFrame):
                            _tmp_vars[idx][var_name] = values.iloc[vidx]
                        else:
                            raise ValueError('Failed to iterate through for_each variable {}'.format(short_repr(values)))
                _vars.extend(copy.deepcopy(_tmp_vars))

    # directive input
    def process_input_args(self, ifiles, **kwargs):
        '''This function handles directive input and all its parameters.
        It
            determines and set __step_input__
            determines and set pattern variables if needed
        returns
            _groups
            _vars
        which are groups of _input and related _vars
        '''
        if isinstance(ifiles, Undetermined):
            env.sos_dict.set('input', Undetermined())
            env.sos_dict.set('_input', Undetermined())
            # temporarily set depends and output to Undetermined because we cannot
            # go far with such input
            env.sos_dict.set('output', Undetermined())
            return [Undetermined()], [{}]

        for k in kwargs.keys():
            if k not in SOS_INPUT_OPTIONS:
                raise RuntimeError('Unrecognized input option {}'.format(k))
        #
        if 'filetype' in kwargs:
            if isinstance(kwargs['filetype'], str):
                ifiles = fnmatch.filter(ifiles, kwargs['filetype'])
            elif isinstance(kwargs['filetype'], Iterable):
                ifiles = [x for x in ifiles if any(fnmatch.fnmatch(x, y) for y in kwargs['filetype'])]
            elif callable(kwargs['filetype']):
                ifiles = [x for x in ifiles if kwargs['filetype'](x)]
        #
        # input file is the filtered files
        env.sos_dict.set('input', ifiles)
        env.sos_dict.set('_input', ifiles)
        #
        # handle group_by
        if 'group_by' in kwargs:
            _groups = Base_Step_Executor.handle_group_by(ifiles, kwargs['group_by'])
        else:
            _groups = [ifiles]
        #
        _vars = [{} for x in _groups]
        # handle paired_with
        if 'paired_with' in kwargs:
            Base_Step_Executor.handle_paired_with(kwargs['paired_with'], ifiles,  _groups, _vars)
        # handle pattern
        if 'pattern' in kwargs:
            Base_Step_Executor.handle_extract_pattern(kwargs['pattern'], ifiles, _groups, _vars)
        # handle for_each
        if 'for_each' in kwargs:
            Base_Step_Executor.handle_for_each(kwargs['for_each'], _groups, _vars)
        return _groups, _vars

    def process_depends_args(self, dfiles, **kwargs):
        for k in kwargs.keys():
            if k not in SOS_DEPENDS_OPTIONS:
                raise RuntimeError('Unrecognized depends option {}'.format(k))
        env.sos_dict.set('_depends', dfiles)
        if env.sos_dict['depends'] is None:
            env.sos_dict.set('depends', copy.deepcopy(dfiles))
        elif env.sos_dict['depends'] != dfiles:
            env.sos_dict['depends'].extend(dfiles)

    def process_output_args(self, ofiles, **kwargs):
        for k in kwargs.keys():
            if k not in SOS_OUTPUT_OPTIONS:
                raise RuntimeError('Unrecognized output option {}'.format(k))
        # create directory
        if not isinstance(ofiles, Undetermined):
            for ofile in ofiles:
                if isinstance(ofile, str):
                    parent_dir = os.path.split(os.path.expanduser(ofile))[0]
                    if parent_dir and not os.path.isdir(parent_dir):
                        os.makedirs(parent_dir)
        # set variables
        env.sos_dict.set('_output', ofiles)
        if isinstance(env.sos_dict['output'], (type(None), Undetermined)):
            env.sos_dict.set('output', copy.deepcopy(ofiles))
        elif not isinstance(env.sos_dict['output'], Undetermined) and env.sos_dict['output'] != ofiles:
            env.sos_dict['output'].extend(ofiles)

    def process_task_args(self, **kwargs):
        for k,v in kwargs.items():
            if k not in SOS_RUNTIME_OPTIONS:
                raise RuntimeError('Unrecognized runtime option {}={}'.format(k, v))
        env.sos_dict.set('_runtime', kwargs)

    def prepare_input_loop(self):
        # what do do before input loop
        pass

    def reevaluate_output(self):
        pass

    def prepare_task(self):
        env.sos_dict['_runtime']['cur_dir'] = os.getcwd()
        if 'workdir' in env.sos_dict['_runtime'] and not os.path.isdir(os.path.expanduser(env.sos_dict['_runtime']['workdir'])):
            try:
                os.makedirs(os.path.expanduser(env.sos_dict['_runtime']['workdir']))
            except Exception as e:
                raise RuntimeError('Failed to create workdir {}'.format(env.sos_dict['_runtime']['workdir']))
        if 'env' in env.sos_dict['_runtime']:
            env.sos_dict['_runtime']['env'].update({x:y for x,y in os.environ.items() if x not in env.sos_dict['_runtime']['env'] and isinstance(y, str)})
        else:
            env.sos_dict['_runtime']['env'] = {x:y for x,y in os.environ.items() if isinstance(y, str)}
        if 'prepend_path' in env.sos_dict['_runtime']:
            if isinstance(env.sos_dict['_runtime']['prepend_path'], str):
                env.sos_dict['_runtime']['env']['PATH'] = env.sos_dict['_runtime']['prepend_path'] + os.pathsep + env.sos_dict['_runtime']['env']['PATH']
            elif isinstance(env.sos_dict['_runtime']['prepend_path'], Sequence):
                env.sos_dict['_runtime']['env']['PATH'] = os.pathsep.join(env.sos_dict['_runtime']['prepend_path']) + os.pathsep + env.sos_dict['_runtime']['env']['PATH']
            else:
                raise ValueError('Unacceptable input for option prepend_path: {}'.format(env.sos_dict['_runtime']['prepend_path']))

        task_vars = env.sos_dict.clone_selected_vars(env.sos_dict['__signature_vars__'] \
                    | {'_input', '_output', '_depends', 'input', 'output', 'depends', '__report_output__',
                    '_local_input_{}'.format(env.sos_dict['_index']),
                    '_local_output_{}'.format(env.sos_dict['_index']),
                    '_index', '__args__', 'step_name', '_runtime',  '__workflow_sig__',
                    'CONFIG', '__signature_vars__', '__step_context__', '__config_file__'
                    })

        if env.__queue__:
            self.host = Host(env.__queue__)
        elif 'queue' in env.sos_dict['_runtime'] and env.sos_dict['_runtime']['queue']:
            self.host = Host(env.sos_dict['_runtime']['queue'])
        else:
            # local host
            self.host = Host()

        if env.sos_dict['_input'] and not isinstance(env.sos_dict['_input'], Undetermined):
            self.host.send_to_host(env.sos_dict['_input'])
        if env.sos_dict['_depends'] and not isinstance(env.sos_dict['_depends'], Undetermined):
            self.host.send_to_host(env.sos_dict['_depends'])
        if 'to_host' in env.sos_dict['_runtime']:
            self.host.send_to_host(env.sos_dict['_runtime']['to_host'])

        # map variables
        vars = ['_input', '_output', '_depends', 'input', 'output', 'depends', '__report_output__', '_runtime',
            '_local_input_{}'.format(env.sos_dict['_index']),
            '_local_output_{}'.format(env.sos_dict['_index'])] + list(env.sos_dict['__signature_vars__'])
        preserved = set()
        if 'preserved_vars' in env.sos_dict['_runtime']:
            if isinstance(env.sos_dict['_runtime']['preserved_vars'], str):
                preserved.add(env.sos_dict['_runtime']['preserved_vars'])
            elif isinstance(env.sos_dict['_runtime']['preserved_vars'], (set, Sequence)):
                preserved |= set(env.sos_dict['_runtime']['preserved_vars'])
            else:
                raise ValueError('Unacceptable value for runtime option preserved_vars: {}'.format(env.sos_dict['_runtime']['preserved_vars']))
        env.logger.debug('Translating {}'.format(vars))
        for var in vars:
            if var in preserved:
                env.logger.debug('Value of variable {} is preserved'.format(var))
            elif var == '_runtime':
                task_vars[var]['cur_dir'] = self.host.map_var(env.sos_dict[var]['cur_dir'])
                if 'workdir' in env.sos_dict[var]:
                    task_vars[var]['workdir'] = self.host.map_var(env.sos_dict[var]['workdir'])
            elif var in env.sos_dict and pickleable(env.sos_dict[var], var):
                try:
                    task_vars[var] = self.host.map_var(env.sos_dict[var])
                    if task_vars[var] != env.sos_dict[var]:
                        env.logger.info('On {}: ``{}`` = {}'.format(self.host.alias, var, short_repr(task_vars[var])))
                    else:
                        env.logger.debug('{}: {} is kept'.format(var, short_repr(env.sos_dict[var])))
                except Exception as e:
                    env.logger.debug(e)
            else:
                env.logger.debug('Variable {} not in env.'.format(var))

        # save task to a file
        param = TaskParams(
            name = '{} (index={})'.format(self.step.step_name(), env.sos_dict['_index']),
            data = (
                self.step.task,          # task
                task_vars,
                self.step.sigil
            )
        )
        # if no output (thus no signature)
        # temporarily create task signature to obtain sig_id
        task_id = RuntimeInfo(self.step.md5, self.step.task, task_vars['_input'],
            task_vars['_output'], task_vars['_depends'],
            task_vars['__signature_vars__'], task_vars).sig_id
        job_file = os.path.join(os.path.expanduser('~'), '.sos', 'tasks', task_id + '.task')
        with open(job_file, 'wb') as jf:
            try:
                pickle.dump(param, jf)
            except Exception as e:
                env.logger.warning(e)
                raise
        return task_id


    def wait_for_results(self):
        results = self.pending_tasks([x for x in self.proc_results if isinstance(x, str)])

        for idx, task in enumerate(self.proc_results):
            # if it is done
            if isinstance(task, dict):
                continue

            res = results[task]

            if res['succ'] != 0:
                env.logger.error('Remote job failed.')
            else:
                if env.sos_dict['_output'] and not isinstance(env.sos_dict['_output'], Undetermined):
                    self.host.receive_from_host(env.sos_dict['_output'])
                if 'from_host' in env.sos_dict['_runtime']:
                    self.host.receive_from_host(env.sos_dict['_runtime']['from_host'])
            self.proc_results[idx] = res

    def log(self, stage=None, msg=None):
        raise RuntimeError('Please redefine the log function in derived step executor.')

    def assign(self, key, value):
        try:
            env.sos_dict.set(key, SoS_eval(value, self.step.sigil))
        except (UnknownTarget, RemovedTarget, UnavailableLock):
            raise
        except Exception as e:
            raise RuntimeError('Failed to assign {} to variable {}: {}'.format(value, key, e))

    def execute(self, stmt, sig=None):
        try:
            env.sos_dict.set('__local_input__', [])
            env.sos_dict.set('__local_output__', [])
            if sig is None:
                env.sos_dict.set('__step_sig__', None)
            else:
                env.sos_dict.set('__step_sig__', os.path.basename(sig.proc_info).split('.')[0])
            self.last_res = SoS_exec(stmt, self.step.sigil)
            if env.sos_dict['__local_input__']:
                env.sos_dict['_local_input_{}'.format(env.sos_dict['_index'])].extend(env.sos_dict['__local_input__'])
                env.sos_dict['local_input'].extend(env.sos_dict['__local_input__'])
            if env.sos_dict['__local_output__']:
                env.sos_dict['_local_output_{}'.format(env.sos_dict['_index'])].extend(env.sos_dict['__local_output__'])
                env.sos_dict['local_output'].extend(env.sos_dict['__local_output__'])
        except (AbortExecution, UnknownTarget, RemovedTarget, UnavailableLock):
            raise
        except Exception as e:
            raise RuntimeError('Failed to process statement {}: {}'.format(short_repr(stmt), e))
        finally:
            env.sos_dict.set('__step_sig__', None)


    def collect_result(self):
        # only results will be sent back to the master process
        #
        # __step_input__:    input of this step
        # __steo_output__:   output of this step
        # __step_depends__:  dependent files of this step
        result = {
            '__step_input__': env.sos_dict['input'],
            '__step_output__': env.sos_dict['output'],
            '__step_local_input__': env.sos_dict['local_input'],
            '__step_local_output__': env.sos_dict['local_output'],
            '__step_depends__': env.sos_dict['depends'],
            '__step_name__': env.sos_dict['step_name'],
        }
        result['__last_res__'] = self.last_res
        result['__changed_vars__'] = set()
        result['__shared__'] = {}
        if 'shared' in self.step.options:
            vars = self.step.options['shared']
            if isinstance(vars, str):
                result['__changed_vars__'].add(vars)
                result['__shared__'][vars] = copy.deepcopy(env.sos_dict[vars])
            elif isinstance(vars, Mapping):
                result['__changed_vars__'] |= vars.keys()
                for var in vars.keys():
                    result['__shared__'][var] = copy.deepcopy(env.sos_dict[var])
            elif isinstance(vars, Sequence):
                for item in vars:
                    if isinstance(item, str):
                        result['__changed_vars__'].add(item)
                        result['__shared__'][item] = copy.deepcopy(env.sos_dict[item])
                    elif isinstance(item, Mapping):
                        result['__changed_vars__'] |= item.keys()
                        for var in item.keys():
                            result['__shared__'][var] = copy.deepcopy(env.sos_dict[var])
                    else:
                        raise ValueError('Option shared should be a string, a mapping of expression, or a list of string or mappings. {} provided'.format(vars))
            else:
                raise ValueError('Option shared should be a string, a mapping of expression, or a list of string or mappings. {} provided'.format(vars))

        if hasattr(env, 'accessed_vars'):
            result['__environ_vars__'] = self.environ_vars
            result['__signature_vars__'] = env.accessed_vars
        return result

    def run(self):
        '''Execute a single step and return results. The result for batch mode is the
        input, output etc returned as alias, and for interactive mode is the return value
        of the last expression. '''
        # return value of the last executed statement
        self.last_res = None
        #
        self.log('start')
        #
        # prepare environments, namely variables that can be used by the step
        #
        # * step_name:  name of the step, can be used by step process to determine
        #               actions dynamically.
        env.sos_dict.set('step_name', self.step.step_name(False))
        # used by nested workflow
        env.sos_dict.set('__step_context__', self.step.context)

        env.sos_dict.set('_runtime', {})

        # * input:      input files, which should be __step_output__ if it is defined, or
        #               None otherwise.
        # * _input:     first batch of input, which should be input if no input statement is used
        # * output:     None at first, can be redefined by output statement
        # * _output:    None at first, can be redefined by output statement
        # * depends:    None at first, can be redefined by depends statement
        # * _depends:   None at first, can be redefined by depends statement
        #
        if '__step_output__' not in env.sos_dict:
            env.sos_dict.set('input', None)
        else:
            if env.sos_dict['__step_output__'] is not None and not isinstance(env.sos_dict['__step_output__'], (list, Undetermined)):
                raise RuntimeError('__step_output__ can only be None, Undetermined, or a list of files.')
            env.sos_dict.set('input', copy.deepcopy(env.sos_dict['__step_output__']))

        # input can be Undetermined from undetermined output from last step
        env.sos_dict.set('_input', copy.deepcopy(env.sos_dict['input']))
        if '__default_output__' in env.sos_dict:
            env.sos_dict.set('output', copy.deepcopy(env.sos_dict['__default_output__']))
            env.sos_dict.set('_output', copy.deepcopy(env.sos_dict['__default_output__']))
        else:
            env.sos_dict.set('output', None)
            env.sos_dict.set('_output', None)
        env.sos_dict.set('depends', None)
        env.sos_dict.set('_depends', None)
        env.sos_dict.set('local_input', [])
        env.sos_dict.set('local_output', [])
        env.sos_dict.set('_local_input_0', [])
        env.sos_dict.set('_local_output_0', [])
        # _index is needed for pre-input action's active option and for debug output of scripts
        env.sos_dict.set('_index', 0)

        # look for input statement.
        input_statement_idx = [idx for idx,x in enumerate(self.step.statements) if x[0] == ':' and x[1] == 'input']
        if not input_statement_idx:
            input_statement_idx = None
        elif len(input_statement_idx) == 1:
            input_statement_idx = input_statement_idx[0]
        else:
            raise ValueError('More than one step input are specified in step {}'.format(self.step.step_name()))

        # if there is an input statement, execute the statements before it, and then the input statement
        if input_statement_idx is not None:
            # execute before input stuff
            for statement in self.step.statements[:input_statement_idx]:
                if statement[0] == '=':
                    self.assign(statement[1], statement[2])
                elif statement[0] == ':':
                    key, value = statement[1:]
                    if key != 'depends':
                        raise ValueError('Step input should be specified before {}'.format(key))
                    try:
                        args, kwargs = SoS_eval('__null_func__({})'.format(value), self.step.sigil)
                        dfiles = self.expand_depends_files(*args)
                        # dfiles can be Undetermined
                        self.process_depends_args(dfiles, **kwargs)
                    except Exception as e:
                        raise RuntimeError('Failed to process step {}: {} ({})'.format(key, value.strip(), e))
                else:
                    try:
                        self.execute(statement[1])
                    except AbortExecution as e:
                        if e.message:
                            env.logger.warning(e)
                        return self.collect_result()
            # input statement
            stmt = self.step.statements[input_statement_idx][2]
            self.log('input statement', stmt)
            try:
                args, kwargs = SoS_eval('__null_func__({})'.format(stmt), self.step.sigil)
                # Files will be expanded differently with different running modes
                input_files = self.expand_input_files(stmt, *args)
                self._groups, self._vars = self.process_input_args(input_files, **kwargs)
            except (UnknownTarget, RemovedTarget, UnavailableLock):
                raise
            except Exception as e:
                raise ValueError('Failed to process input statement {}: {}'.format(stmt, e))

            input_statement_idx += 1
        else:
            # default case
            self._groups = [env.sos_dict['input']]
            self._vars = [{}]
            # assuming everything starts from 0 is after input
            input_statement_idx = 0

        self.log('input')

        self.proc_results = []
        # run steps after input statement, which will be run multiple times for each input
        # group.
        env.sos_dict.set('__num_groups__', len(self._groups))

        self.prepare_input_loop()

        # determine if a single index or the whole step should be skipped
        skip_index = False
        # signatures of each index, which can remain to be None if no output
        # is defined.
        signatures = [None for x in self._groups]
        self.output_groups = [[] for x in self._groups]
        try:
            for idx, (g, v) in enumerate(zip(self._groups, self._vars)):
                # other variables
                # side input and outputs are tracked for each execution unit
                # to keep the signature clean
                env.sos_dict.set('_local_input_{}'.format(idx), [])
                env.sos_dict.set('_local_output_{}'.format(idx), [])
                #
                env.sos_dict.update(v)
                env.sos_dict.set('_input', g)
                self.log('_input')
                env.sos_dict.set('_index', idx)
                #
                pre_statement = []
                if not any(st[0] == ':' and st[1] == 'output' for st in self.step.statements[input_statement_idx:]) and \
                    '__default_output__' in env.sos_dict:
                    pre_statement = [[':', 'output', '_output']]

                for statement in pre_statement + self.step.statements[input_statement_idx:]:
                    # if input is undertermined, we can only process output:
                    if isinstance(g, Undetermined) and statement[0] != ':':
                        return self.collect_result()
                    if statement[0] == '=':
                        self.assign(statement[1], statement[2])
                    elif statement[0] == ':':
                        key, value = statement[1:]
                        # output, depends, and process can be processed multiple times
                        try:
                            args, kwargs = SoS_eval('__null_func__({})'.format(value), self.step.sigil)
                            # dynamic output or dependent files
                            if key == 'output':
                                # if output is defined, its default value needs to be cleared
                                if idx == 0:
                                    env.sos_dict.set('output', None)
                                ofiles = self.expand_output_files(value, *args)
                                if not isinstance(g, (type(None), Undetermined)) and not isinstance(ofiles, (type(None), Undetermined)):
                                    if any(x in g for x in ofiles):
                                        raise RuntimeError('Overlapping input and output files: {}'
                                            .format(', '.join(repr(x) for x in ofiles if x in g)))
                                # set variable _output and output
                                self.process_output_args(ofiles, **kwargs)
                                self.output_groups[idx] = env.sos_dict['_output']

                                # ofiles can be Undetermined
                                sg = self.step_signature(idx)
                                if sg is not None and not isinstance(g, Undetermined):
                                    signatures[idx] = RuntimeInfo(self.step.md5, sg, env.sos_dict['_input'],
                                        env.sos_dict['_output'], env.sos_dict['_depends'],
                                        env.sos_dict['__signature_vars__'])
                                    signatures[idx].lock()
                                    if env.sig_mode == 'default':
                                        matched = signatures[idx].validate()
                                        if isinstance(matched, dict):
                                            # in this case, an Undetermined output can get real output files
                                            # from a signature
                                            env.sos_dict.set('_input', matched['input'])
                                            env.sos_dict.set('_depends', matched['depends'])
                                            env.sos_dict.set('_output', matched['output'])
                                            env.sos_dict.set('_local_input', matched['local_output'])
                                            env.sos_dict.set('_local_output', matched['local_output'])
                                            env.sos_dict['local_input'].extend(env.sos_dict['_local_input'])
                                            env.sos_dict['local_output'].extend(env.sos_dict['_local_output'])
                                            env.sos_dict.update(matched['vars'])
                                            env.logger.info('Step ``{}`` (index={}) is ``ignored`` due to saved signature'.format(env.sos_dict['step_name'], idx))
                                            skip_index = True
                                        else:
                                            env.logger.debug('Signature mismatch: {}'.format(matched))
                                    elif env.sig_mode == 'assert':
                                        matched = signatures[idx].validate()
                                        if isinstance(matched, str):
                                            raise RuntimeError('Signature mismatch: {}'.format(matched))
                                        else:
                                            env.sos_dict.set('_input', matched['input'])
                                            env.sos_dict.set('_depends', matched['depends'])
                                            env.sos_dict.set('_output', matched['output'])
                                            env.sos_dict.set('_local_input', matched['local_output'])
                                            env.sos_dict.set('_local_output', matched['local_output'])
                                            env.sos_dict['local_input'].extend(env.sos_dict['_local_input'])
                                            env.sos_dict['local_output'].extend(env.sos_dict['_local_output'])
                                            env.sos_dict.update(matched['vars'])
                                            env.logger.info('Step ``{}`` (index={}) is ``ignored`` with matching signature'.format(env.sos_dict['step_name'], idx))
                                            skip_index = True
                                    elif env.sig_mode == 'build':
                                        # build signature require existence of files
                                        if signatures[idx].write(
                                            env.sos_dict['_local_input_{}'.format(idx)],
                                            env.sos_dict['_local_output_{}'.format(idx)],
                                            rebuild=True):
                                            env.logger.info('Step ``{}`` (index={}) is ``ignored`` with signature constructed'.format(env.sos_dict['step_name'], idx))
                                            skip_index = True
                                    elif env.sig_mode == 'force':
                                        skip_index = False
                                    else:
                                        raise RuntimeError('Unrecognized signature mode {}'.format(env.sig_mode))
                                if skip_index:
                                    break
                            elif key == 'depends':
                                dfiles = self.expand_depends_files(*args)
                                # dfiles can be Undetermined
                                self.process_depends_args(dfiles, **kwargs)
                            elif key == 'task':
                                self.process_task_args(*args, **kwargs)
                            else:
                                raise RuntimeError('Unrecognized directive {}'.format(key))
                        except (UnknownTarget, RemovedTarget, UnavailableLock):
                            raise
                        except Exception as e:
                            # if input is Undertermined, it is possible that output cannot be processed
                            # due to that, and we just return
                            if isinstance(g, Undetermined):
                                return self.collect_result()
                            raise RuntimeError('Failed to process step {}: {} ({})'.format(key, value.strip(), e))
                    else:
                        try:
                            self.verify_input()
                            self.execute(statement[1], signatures[idx])
                        except AbortExecution as e:
                            self.output_groups[idx] = []
                            if e.message:
                                env.logger.warning(e)
                            skip_index = True
                            break
                # if this index is skipped, go directly to the next one
                if skip_index:
                    skip_index = False
                    if signatures[idx]:
                        signatures[idx].release()
                        signatures[idx] = None
                    continue
                # finally, tasks..
                if not self.step.task:
                    if signatures[idx] is not None:
                        signatures[idx].write(
                            env.sos_dict['_local_input_{}'.format(idx)],
                            env.sos_dict['_local_output_{}'.format(idx)])
                        signatures[idx].release()
                        signatures[idx] = None
                    continue

                # check if the task is active
                if 'active' in env.sos_dict['_runtime']:
                    active = env.sos_dict['_runtime']['active']
                    if isinstance(active, int):
                        if active >= 0 and env.sos_dict['_index'] != active:
                            continue
                        if active < 0 and env.sos_dict['_index'] != active + env.sos_dict['__num_groups__']:
                            continue
                    elif isinstance(active, Sequence):
                        allowed_index = list([x if x >= 0 else env.sos_dict['__num_groups__'] + x for x in active])
                        if env.sos_dict['_index'] not in allowed_index:
                            continue
                    elif isinstance(active, slice):
                        allowed_index = list(range(env.sos_dict['__num_groups__']))[active]
                        if env.sos_dict['_index'] not in allowed_index:
                            continue
                    else:
                        raise RuntimeError('Unacceptable value for option active: {}'.format(active))

                self.log('task')
                try:
                    task = self.prepare_task()
                    self.proc_results.append(task)
                except Exception as e:
                    # FIXME: cannot catch exception from subprocesses
                    if env.verbosity > 2:
                        sys.stderr.write(get_traceback())
                    raise RuntimeError('Failed to execute process\n"{}"\n{}'.format(short_repr(self.step.task), e))
                #
                # if not concurrent, we have to wait for the completion of the task
                if 'concurrent' not in env.sos_dict['_runtime'] or not env.sos_dict['_runtime']['concurrent']:
                    self.wait_for_results()
                #
                # endfor loop for each input group
                #
            # check results? This is only meaningful for pool
            self.wait_for_results()
            for idx,res in enumerate(self.proc_results):
                if signatures[idx] is not None:
                    if res['succ'] == 0:
                        signatures[idx].write(
                            env.sos_dict['_local_input_{}'.format(idx)],
                            env.sos_dict['_local_output_{}'.format(idx)])
                    signatures[idx].release()
                    signatures[idx] = None
            # check results
            for x in self.proc_results:
                if x['succ'] != 0:
                    raise x['exception']
            # if output is Undetermined, re-evalulate it
            #
            # NOTE: dynamic output is evaluated at last, so it sets output,
            # not _output. For the same reason, signatures can be wrong if it has
            # Undetermined output.
            if env.run_mode in ('run', 'interactive'):
                if isinstance(env.sos_dict['output'], Undetermined):
                    self.reevaluate_output()
                    # if output is no longer Undetermined, set it to output
                    # of each signature
                    for sig in signatures:
                        if sig is not None:
                            sig.set(env.sos_dict['output'], 'output')
                else:
                    # finalize output from output_groups because some output might be skipped
                    # this is the final version of the output but we do maintain output
                    # during the execution of step, for compatibility.
                    env.sos_dict.set('output', self.output_groups[0])
                    for og in self.output_groups[1:]:
                        if og != env.sos_dict['output']:
                            env.sos_dict['output'].extend(og)

            self.log('output')
            # variables defined by the shared option needs to be available to be verified
            if 'shared' in self.step.options:
                if isinstance(self.step.options['shared'], Mapping):
                    for var, val in self.step.options['shared'].items():
                        if var == val:
                            continue
                        try:
                            env.sos_dict.set(var, SoS_eval(val, self.step.sigil))
                        except Exception as e:
                            raise RuntimeError('Failed to evaluate shared variable {} from expression {}: {}'
                                .format(var, val, e))
                # if there are dictionaries in the sequence, e.g.
                # shared=['A', 'B', {'C':'D"}]
                elif isinstance(self.step.options['shared'], Sequence):
                    for item in self.step.options['shared']:
                        if isinstance(item, Mapping):
                            for var, val in item.items():
                                if var == val:
                                    continue
                                try:
                                    env.sos_dict.set(var, SoS_eval(val, self.step.sigil))
                                except Exception as e:
                                    raise RuntimeError('Failed to evaluate shared variable {} from expression {}: {}'
                                        .format(var, val, e))
            #
            self.verify_output()
            return self.collect_result()
        finally:
            # release all signatures
            for sig in signatures:
                if sig is not None:
                    sig.release()

class Queued_Step_Executor(Base_Step_Executor):
    # this class execute the step in a separate process
    # and returns result using a queue
    def __init__(self, step, pipe):
        Base_Step_Executor.__init__(self, step)
        self.pipe = pipe

    def pending_tasks(self, tasks):
        env.logger.debug('Send {}'.format(tasks))
        if self.pipe is not None:
            if not tasks:
                return {}
            self.pipe.send('tasks {} {}'.format(self.host.alias, ' '.join(tasks)))
            # wait till the executor responde
            results = self.pipe.recv()
            return results

    def run(self):
        try:
            # update every 60 seconds
            notifier = ActivityNotifier('Running {}'.format(self.step.step_name()), delay=60)
            res = Base_Step_Executor.run(self)
            if self.pipe is not None:
                self.pipe.send(res)
            else:
                return res
        except Exception as e:
            if env.verbosity > 2:
                sys.stderr.write(get_traceback())
            if self.pipe is not None:
                self.pipe.send(e)
            else:
                raise e
        finally:
            notifier.stop()

def _expand_file_list(ignore_unknown, *args):
    ifiles = []
    for arg in args:
        if arg is None:
            continue
        elif isinstance(arg, BaseTarget):
            ifiles.append(arg)
        elif isinstance(arg, str):
            ifiles.append(os.path.expanduser(arg))
        elif isinstance(arg, Iterable):
            # in case arg is a Generator, check its type will exhaust it
            arg = list(arg)
            if not all(isinstance(x, (str, BaseTarget)) for x in arg):
                raise RuntimeError('Invalid target: {}'.format(arg))
            ifiles.extend(arg)
        else:
            raise RuntimeError('Unrecognized file: {}'.format(arg))

    # expand files with wildcard characters and check if files exist
    tmp = []
    for ifile in ifiles:
        if isinstance(ifile, BaseTarget):
            if ignore_unknown or ifile.exists():
                tmp.append(ifile)
            else:
                raise UnknownTarget(ifile)
        elif FileTarget(ifile).exists():
            tmp.append(ifile)
        else:
            expanded = sorted(glob.glob(os.path.expanduser(ifile)))
            # no matching file ... but this is not a problem at the
            # inspection stage.
            #
            # NOTE: if a DAG is given, the input file can be output from
            # a previous step..
            #
            if not expanded:
                if not ignore_unknown:
                    raise UnknownTarget(ifile)
                else:
                    tmp.append(ifile)
            else:
                tmp.extend(expanded)
    return tmp


class Dryrun_Step_Executor(Queued_Step_Executor):
    '''Run script in prepare mode'''
    def __init__(self, step, queue):
        env.run_mode = 'prepare'
        if hasattr(env, 'accessed_vars'):
            delattr(env, 'accessed_vars')
        Queued_Step_Executor.__init__(self, step, queue)

    def log(self, stage=0, msg=None):
        if stage == 'start':
            env.logger.info('Checking ``{}``: {}'.format(self.step.step_name(), self.step.comment.strip()))
        elif stage == 'input':
            if env.sos_dict['input'] is not None:
                env.logger.info('input:    ``{}``'.format(short_repr(env.sos_dict['input'])))
        elif stage == 'output':
            if env.sos_dict['output'] is not None:
                env.logger.info('output:   ``{}``'.format(short_repr(env.sos_dict['output'])))

    def verify_input(self):
        return

    def verify_output(self):
        # do nothing to verify output
        return

    def expand_input_files(self, value, *args):
        # in prepare mode, we do not resolve unknown targets
        if any(isinstance(x, dynamic) for x in args):
            return Undetermined(value)
        # if unspecified, use __step_output__ as input (default)
        if not args:
            return env.sos_dict['input']
        else:
            return _expand_file_list(True, *args)

    def expand_depends_files(self, *args):
        '''handle directive depends'''
        if any(isinstance(x, dynamic) for x in args):
            for k in args:
                if isinstance(k, dynamic):
                    env.logger.warning('Dependent target {} is dynamic'.format(k))
            return Undetermined()
        else:
            return _expand_file_list(True, *args)

class SP_Step_Executor(Queued_Step_Executor):
    '''Single process step executor'''
    def __init__(self, step, queue):
        env.run_mode = 'run'
        if hasattr(env, 'accessed_vars'):
            delattr(env, 'accessed_vars')
        Queued_Step_Executor.__init__(self, step, queue)

    def verify_input(self):
        # now, if we are actually going to run the script, we
        # need to check the input files actually exists, not just the signatures
        for target in (env.sos_dict['_input'] if isinstance(env.sos_dict['_input'], list) else []) + \
            (env.sos_dict['_depends'] if isinstance(env.sos_dict['_depends'], list) else []):
            # if the file does not exist (although the signature exists)
            # request generation of files
            if isinstance(target, str):
                if not FileTarget(target).exists('target'):
                    # remove the signature and regenerate the file
                    FileTarget(target).remove_sig()
                    raise RemovedTarget(target)
            elif not target.exists('target'):
                target.remove_sig()
                raise RemovedTarget(target)

    def log(self, stage=None, msg=None):
        if stage == 'start':
            env.logger.info('Executing ``{}``: {}'.format(self.step.step_name(), self.step.comment.strip()))
        elif stage == 'input statement':
            env.logger.trace('Handling input statement {}'.format(msg))
        elif stage == '_input':
            if env.sos_dict['_input'] is not None:
                env.logger.debug('_input: ``{}``'.format(short_repr(env.sos_dict['_input'])))
        elif stage == 'input':
            if env.sos_dict['input'] is not None:
                env.logger.info('input:    ``{}``'.format(short_repr(env.sos_dict['input'])))
        elif stage == 'output':
            if env.sos_dict['output'] is not None:
                env.logger.info('output:   ``{}``'.format(short_repr(env.sos_dict['output'])))

    def assign(self, key, value):
        Base_Step_Executor.assign(self, key, value)
        transcribe('{} = {}'.format(key, env.sos_dict[key]))

    def expand_input_files(self, value, *args):
        # if unspecified, use __step_output__ as input (default)
        # resolve dynamic input.
        args = [x.resolve() if isinstance(x, dynamic) else x for x in args]
        if not args:
            return env.sos_dict['input']
        else:
            return _expand_file_list(False, *args)

    def step_signature(self, index):
        '''returns a signature of the step. Change of the step content will
        lead to the invalidation of the signature, which will then cause the
        re-execution of the step for any result from the step. '''
        #
        if env.sig_mode == 'ignore':
            return None
        env_vars = []
        for var in sorted(env.sos_dict['__signature_vars__']):
            if var in env.sos_dict and isinstance(env.sos_dict[var], (str, bool, int, float, complex, bytes, list, tuple, set, dict)):
                env_vars.append('{} = {}\n'.format(var, stable_repr(env.sos_dict[var])))

        # env.logger.warning(''.join(env_vars) + '\n' + self.step.tokens)
        return ''.join(env_vars) + '\n' + self.step.tokens

    def expand_depends_files(self, *args, **kwargs):
        '''handle directive depends'''
        args = [x.resolve() if isinstance(x, dynamic) else x for x in args]
        return _expand_file_list(False, *args)

    def reevaluate_output(self):
        # re-process the output statement to determine output files
        args, kwargs = SoS_eval('__null_func__({})'.format(env.sos_dict['output'].expr), self.step.sigil)
        # handle dynamic args
        args = [x.resolve() if isinstance(x, dynamic) else x for x in args]
        env.sos_dict.set('output', self.expand_output_files('', *args))

    def verify_output(self):
        if env.sos_dict['output'] is None:
            return
        if isinstance(env.sos_dict['output'], Undetermined):
            raise RuntimeError('Output of a completed step cannot be undetermined.')
        for target in env.sos_dict['output']:
            if isinstance(target, str):
                if not FileTarget(target).exists('target' if '__hard_target__' in env.sos_dict else 'any'):
                    raise RuntimeError('Output target {} does not exist after the completion of step {} (curdir={})'
                            .format(target, env.sos_dict['step_name'], os.getcwd()))
            elif not target.exists('any'):
                raise RuntimeError('Output target {} does not exist after the completion of step {}'
                            .format(target, env.sos_dict['step_name']))


class MP_Step_Executor(SP_Step_Executor):
    def __init__(self, step, queue):
        SP_Step_Executor.__init__(self, step, queue)
        self.pool = None

    def log(self, stage=None, msg=None):
        if stage == 'start':
            env.logger.info('Executing ``{}``: {}'.format(self.step.step_name(), self.step.comment.strip()))
        elif stage == '_input':
            if env.sos_dict['_input'] is not None:
                env.logger.debug('{} _input: ``{}``'.format(self.step.step_name(), short_repr(env.sos_dict['_input'])))
        elif stage == 'input':
            if env.sos_dict['input'] is not None:
                env.logger.info('{} input:    ``{}``'.format(self.step.step_name(), short_repr(env.sos_dict['input'])))
        elif stage == 'output':
            if env.sos_dict['output'] is not None:
                env.logger.info('{} output:   ``{}``'.format(self.step.step_name(), short_repr(env.sos_dict['output'])))
