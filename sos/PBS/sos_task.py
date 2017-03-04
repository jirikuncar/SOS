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
import pickle
from sos.utils import env
from sos.sos_eval import interpolate
from sos.sos_task import TaskEngine

class PBS_TaskEngine(TaskEngine):
    def __init__(self, agent):
        super(PBS_TaskEngine, self).__init__(agent)
        # we have self.config for configurations
        #
        # job_template
        # submit_cmd
        #
        # => status_cmd (perhaps not needed)
        # => kill_cmd (perhaps not needed)
        if 'job_template' in self.config:
            self.job_template = self.config['job_template']
        elif 'template_file' in self.config:
            if not os.path.isfile(os.path.expanduser(self.config['template_file'])):
                raise ValueError('Missing job_template file {} for queue {}'.format(self.config['job_template'], self.alias))
            else:
                with open(os.path.expanduser(self.config['template_file'])) as tmpl:
                    self.job_template = tmpl.read()
        else:
            raise ValueError('Missing configuration job_template or template_file for queue {}'.format(self.alias))

        if 'submit_cmd' not in self.config:
            raise ValueError('Missing configuration submit_cmd for queue {}'.format(self.alias))
        else:
            self.submit_cmd = self.config['submit_cmd']

        if 'submit_cmd' not in self.config:
            raise ValueError('Missing configuration submit_cmd for queue {}'.format(self.alias))
        else:
            self.submit_cmd = self.config['submit_cmd']

    def execute_task(self, task_id):
        # read the task file and look for runtime info
        # 
        task_file = os.path.join(os.path.expanduser('~'), '.sos', 'tasks', self.alias, task_id + '.task')
        with open(task_file, 'rb') as task:
            params = pickle.load(task)
            task, sos_dict, sigil = params.data

        # for this task, we will need walltime, nodes, ppn, mem
        # however, these could be fixed in the job template and we do not need to have them all in the runtime
        runtime = {x:sos_dict['_runtime'][x] for x in ('nodes', 'ppn', 'mem', 'cur_dir') if x in sos_dict['_runtime']}
        runtime['task'] = task_id
        runtime['verbosity'] = env.verbosity
        runtime['sig_mode'] = env.sig_mode
        if 'walltime' in sos_dict['_runtime']:
            runtime['walltime'] = self.format_walltime(sos_dict['_runtime']['walltime'], format='hms')
        if 'nodes' not in runtime:
            runtime['nodes'] = 1
        if 'ppn' not in runtime:
            runtime['ppn'] = 1
        runtime['job_file'] = '~/.sos/tasks/{}.pbs'.format(task_id)
        runtime.update(self.config)

        # let us first prepare a task file
        try:
            job_text = interpolate(self.job_template, '${ }', runtime)
        except Exception as e:
            raise ValueError('Failed to generate job file for task {}: {}'.format(task_id, e))

        # now we need to write a job file
        job_file = os.path.join(os.path.expanduser('~'), '.sos', 'tasks', self.alias, task_id + '.pbs')
        with open(job_file, 'w') as job:
            job.write(job_text)

        # then copy the job file to remote host if necessary
        self.agent.send_task_file(task_id + '.pbs')
        #
        # now we need to figure out a command to submit the task
        try:
            cmd = interpolate(self.submit_cmd, '${ }', runtime)
        except Exception as e:
            raise ValueError('Failed to generate job submission command from template "{}": {}'.format(
                self.submit_cmd, e))
        env.logger.debug('submit {}: {}'.format(task_id, cmd))
        env.logger.info('{} ``submitted``'.format(task_id))
        try:
            job_id = self.agent.check_output(cmd)
            # let us write an job_id file so that we can check status of tasks more easily
            job_id_file = os.path.join(os.path.expanduser('~'), '.sos', 'tasks', self.alias, task_id + '.job_id')
            with open(job_id_file, 'w') as job:
                job.write(job_id)
            self.agent.send_task_file(task_id + '.job_id')
        except Exception as e:
            raise RuntimeError('Failed to submit task {}: {}'.format(task_id, e))

    def check_status(self, task):
        try:
            cmd = interpolate(self.status_cmd, '${ }', {'task': task, 'job_id': self.job_ids[task]})
            print(self.agent.check_output(cmd))
        except Exception as e:
            raise ValueError('Failed to get status of job from template "{}": {}'.format(
                self.status_cmd, e))

    def kill_tasks(self, tasks):
        # remove the task from SoS task queue
        super(PBS_TaskEngine, self).kill(tasks)
        # actually kill the task from the PBS system
        for task in tasks:
            try:
                if task in self.job_ids:
                    cmd = interpolate(self.kill_cmd, '${ }', {'task': task, 'job_id': self.job_ids[task]})
                    print(self.agent.check_output(cmd))
            except Exception as e:
                raise ValueError('Failed to kill job from template "{}": {}'.format(
                    self.kill_cmd, e))
        
