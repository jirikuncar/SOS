#!/usr/bin/env python3
#
# This file is part of Script of Scripts (sos), a workflow system
# for the execution of commands and scripts in different languages.
# Please visit https://github.com/vatlab/SOS for more information.
#
# Copyright (C) 2016 Bo Peng (bpeng@mdanderson.org)
##
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

from sos.actions import SoS_Action, SoS_ExecuteScript

@SoS_Action(run_mode=['run', 'interactive'], acceptable_args=['script', 'args'])
def python2(script, args='', **kwargs):
    '''Execute specified script using python2, and python if python2 does
    not exist.'''
    return SoS_ExecuteScript(script, ['python2', 'python2.7', 'python'], '.py', args).run(**kwargs)

