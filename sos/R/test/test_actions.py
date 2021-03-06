#!/usr/bin/env python
#
# This file is part of Script of Scripts (SoS), a workflow system
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
import unittest
import shutil

from sos.sos_script import SoS_Script
from sos.utils import env
from sos.sos_executor import Base_Executor
from sos.target import FileTarget

class TestActions(unittest.TestCase):
    def setUp(self):
        env.reset()
        self.temp_files = []

    def tearDown(self):
        for f in self.temp_files:
            FileTarget(f).remove('both')

    def testRmarkdown(self):
        '''Test action Rmarkdown'''
        if not shutil.which('Rscript'):
            return
        FileTarget('myreport.html').remove()
        script = SoS_Script(r'''
[10]

report:
## Some random figure

Generated by matplotlib


[100]
# generate report
output: 'myreport.html'
Rmarkdown(output=_output[0])
''')
        wf = script.workflow()
        Base_Executor(wf, config={'report_output': 'report.md'}).run()
        self.assertTrue(os.path.isfile('myreport.html'))
        #
        FileTarget('myreport.html').remove('both')

    def testRmarkdownWithInput(self):
        # Rmarkdown with specified input.
        script = SoS_Script(r'''
[10]
report: output='a.md'
## Some random figure

Generated by matplotlib


[100]
# generate report
output: 'myreport.html'
Rmarkdown(input='a.md', output=_output[0])
''')
        wf = script.workflow()
        Base_Executor(wf).run()
        self.assertTrue(os.path.isfile('myreport.html'))
        FileTarget('myreport.html').remove()

#     def testRmarkdownWithNoOutput(self):
#         # another case is no output, so output goes to standard output
#         # this cannot be tested in travis because of limit on log file.
#         script = SoS_Script(r'''
# [10]
# report: output='a.md'
# ## Some random figure
# 
# Generated by matplotlib
# 
# 
# [100]
# # generate report
# Rmarkdown(input='a.md')
# ''')
#         wf = script.workflow()
#         Base_Executor(wf).run()

    def testRmarkdownWithActionOutput(self):
        script = SoS_Script(r'''
[10]
report: output='default_10.md'
A_10

[20]
report: output='default_20.md'
A_20

[100]
# generate report
Rmarkdown(input=['default_10.md', 'default_20.md'], output='output.html')
''')
        wf = script.workflow()
        Base_Executor(wf, config={'report_output': '${step_name}.md'}).run()
        for f in ['default_10.md', 'default_20.md', 'output.html']:
            self.assertTrue(FileTarget(f).exists())
            FileTarget(f).remove()


if __name__ == '__main__':
    unittest.main()
