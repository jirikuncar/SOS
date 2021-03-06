// This file is part of Script of Scripts (sos), a workflow system
// for the execution of commands and scripts in different languages.
// Please visit https://github.com/vatlab/SOS for more information.
//
// Copyright (C) 2016 Bo Peng (bpeng@mdanderson.org)
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.
//
// This is a codemirror mode for SoS, currently a clone of Python codemirror.js
// with some minor modification. An expert on javascript and code mirror
// is required to make it work for other langauges that SoS supports.
//
define([
    'jquery',
    'base/js/utils',
    'codemirror/lib/codemirror',
    'codemirror/addon/selection/active-line'
], function($) {

    "use strict";
    //variables defined as global which enable access from imported scripts.
    window.BackgroundColor = {}
    window.DisplayName = {}
    window.KernelName = {}
    window.KernelList = []
    window.events = require('base/js/events');
    window.utils = require('base/js/utils');
    window.Jupyter = require('base/js/namespace');
    window.CodeCell = require('notebook/js/codecell').CodeCell;

    window.default_kernel = 'sos';
    window.kernel_updated = false;
    window.my_panel = null;
    window.pending_cells = {};

    window.sos_comm = null;

    // initialize BackgroundColor etc from cell meta data
    if (!('sos' in IPython.notebook.metadata))
        IPython.notebook.metadata['sos'] = {
            'kernels': [
                ['sos', 'SoS', '']
            ],
            // panel displayed, position (float or side), old panel height
            'panel': {
                'displayed': true,
                'style': 'side',
                'height': 0
            },
            'celltoolbar': true,
        };
    // for older notebook without panel attribute
    else if (!IPython.notebook.metadata['sos'].panel) {
        IPython.notebook.metadata['sos'].panel = {
            'displayed': true,
            'style': 'side',
            'height': 0
        };
        IPython.notebook.metadata['sos'].celltoolbar = true;
    }
    // Initial style is always side but the style is saved and we can honor this
    // configuration later on.
    IPython.notebook.metadata['sos']['panel'].style = 'side';

    window.data = IPython.notebook.metadata['sos']['kernels'];
    for (var i = 0; i < data.length; i++) {
        // BackgroundColor is color
        BackgroundColor[data[i][0]] = data[i][2];
        BackgroundColor[data[i][1]] = data[i][2];
        // DisplayName
        DisplayName[data[i][0]] = data[i][1];
        DisplayName[data[i][1]] = data[i][1];
        // Name
        KernelName[data[i][0]] = data[i][0];
        KernelName[data[i][1]] = data[i][0];
        // KernelList, use displayed name
        KernelList.push([data[i][1], data[i][1]])
    }

    var my_execute = function(code, callbacks, options) {
        "use strict"
        /* check if the code is a workflow call, which is marked by
         * %sosrun or %sossave workflowname with options
         */
        var workflow = '';
        var run_notebook = false;
        var lines = code.split('\n');
        for (var l = 0; l < lines.length; ++l) {
            if (lines[l].startsWith('#') || lines[l].trim() == '' || lines[l].startsWith('!'))
                continue
            // other magic
            if (lines[l].startsWith('%')) {
                console.log(lines[l]);
                if (lines[l].match(/^%sosrun($|\s)|^%sossave($|\s)|^%preview\s.*(-w|--workflow).*$/)) {
                    run_notebook = true;
                    break;
                } else
                    continue
            } else {
                run_notebook = false
                break;
            }
        }

        if (run_notebook) {
            var cells = IPython.notebook.get_cells();
            for (var i = 0; i < cells.length; ++i) {
                if (cells[i].cell_type == 'code' && (cells[i].metadata.kernel == undefined || cells[i].metadata.kernel === 'sos')) {
                    workflow += get_workflow_from_cell(cells[i])
                }
            }
        }
        var rerun_option = '';
        var cells = IPython.notebook.get_cells();
        for (var i = cells.length - 1; i >= 0; --i) {
            // this is the cell that is being executed...
            // according to this.set_input_prompt('*') before execute is called.
            // also, because a cell might be starting without a previous cell
            // being finished, we should start from reverse and check actual code
            if (cells[i].input_prompt_number == '*' && code == cells[i].get_text()) {
                // use cell kernel if meta exists, otherwise use window.default_kernel
                if (window._auto_resume) {
                    rerun_option = ' --resume ';
                    window._auto_resume = false;
                }
                return this.orig_execute(
                    // passing to kernel
                    // 1. the default kernel (might have been changed from menu bar
                    // 2. cell kernel (might be unspecified for new cell)
                    // 3. cell index (for setting style after execution)
                    // in addition, the frontend command will send a "--list-kernel" request if
                    // the frontend is not correctly initialized, possibly because the kernel was
                    // not ready when the frontend sent the command `%listkernel`.
                    "%frontend " +
                    (window.kernel_updated ? "" : " --list-kernel ") +
                    (IPython.notebook.metadata['sos']['panel'].displayed ? " --use-panel" : "") +
                    " --default-kernel " + window.default_kernel +
                    " --cell-kernel " + cells[i].metadata.kernel +
                    (run_notebook ? " --filename '" + window.document.getElementById("notebook_name").innerHTML + "'" : '') +
                    (run_notebook ? " --workflow " + btoa(workflow) : '') + rerun_option +
                    " --cell " + i.toString() + "\n" + code,
                    callbacks, options)
            }
        }
        // if this is a command from scratch pad (not part of the notebook)
        return this.orig_execute(
            "%frontend " +
            (window.kernel_updated ? "" : " --list-kernel ") +
            " --default-kernel " + window.default_kernel +
            " --cell-kernel " + window.my_panel.cell.metadata.kernel +
            (run_notebook ? " --filename '" + window.document.getElementById("notebook_name").innerHTML + "'" : '') +
            (run_notebook ? " --workflow " + btoa(workflow) : '') + rerun_option +
            " --cell -1 " + "\n" + code,
            callbacks, {
                'silent': false,
                'store_history': false
            })
    }

    function register_sos_comm() {
        // comm message sent from the kernel
        window.sos_comm = Jupyter.notebook.kernel.comm_manager.new_comm('sos_comm', {});
        window.sos_comm.on_msg(function(msg) {
            // when the notebook starts it should receive a message in the format of
            // a nested array of elements such as
            //
            // "ir", "R", "#ABackgroundColorDEF"
            //
            // where are kernel name (jupyter kernel), displayed name (SoS), and background
            // color assigned by the language module. The user might use name ir or R (both
            // acceptable) but the frontend should only display displayed name, and send
            // the real kernel name back to kernel (%frontend and metadata).
            //
            // there are two kinds of messages from my_execute
            // 1. cell_idx: kernel
            //     the kernel used for the cell with source
            // 2. None: kernel
            //     the kernel for the new cell

            var data = msg.content.data;
            var msg_type = msg.metadata.msg_type;

            if (msg_type == 'kernel-list') {
                if (window.kernel_updated)
                    return;
                for (var i = 0; i < data.length; i++) {
                    // BackgroundColor is color
                    BackgroundColor[data[i][0]] = data[i][2];
                    BackgroundColor[data[i][1]] = data[i][2];
                    // DisplayName
                    DisplayName[data[i][0]] = data[i][1];
                    DisplayName[data[i][1]] = data[i][1];
                    // Name
                    KernelName[data[i][0]] = data[i][0];
                    KernelName[data[i][1]] = data[i][0];
                    // KernelList, use displayed name
                    if (KernelList.findIndex((item) => item[0] === data[i][1]) == -1)
                        KernelList.push([data[i][1], data[i][1]]);
                    // if the kernel is not in metadata, push it in
                    var k_idx = IPython.notebook.metadata['sos']['kernels'].findIndex((item) => item[0] === data[i][0])
                    if (k_idx == -1)
                        IPython.notebook.metadata['sos']['kernels'].push(data[i])
                    else {
                        // if language exist update the display name and color, in case it was using old ones
                        IPython.notebook.metadata['sos']['kernels'][k_idx][1] = data[i][1];
                        IPython.notebook.metadata['sos']['kernels'][k_idx][2] = data[i][2];
                    }
                }
                //add dropdown menu of kernels in frontend
                load_select_kernel();
                window.kernel_updated = true;
                console.log('kernel list updated');
            } else if (msg_type == 'default-kernel') {
                // update the cells when the notebook is being opened.
                // we also set a global kernel to be used for new cells
                $('#kernel_selector').val(DisplayName[data]);
                // a side effect of change is cells without metadata kernel info will change background
                $('#kernel_selector').change();
            } else if (msg_type == 'cell-kernel') {
                // get cell from passed cell index, which was sent through the
                // %frontend magic
                if (data[0] == -1)
                    var cell = window.my_panel.cell;
                else
                    var cell = IPython.notebook.get_cell(data[0]);
                if (cell.metadata.kernel != KernelName[data[1]]) {
                    cell.metadata.kernel = KernelName[data[1]];
                    // set meta information
                    changeStyleOnKernel(cell, data[1])
                }
            } else if (msg_type == 'preview-input') {
                cell = window.my_panel.cell;
                cell.clear_input();
                cell.set_text(data);
                cell.clear_output();
            } else if (msg_type == 'preview-kernel') {
                changeStyleOnKernel(window.my_panel.cell, data);
            } else if (msg_type == 'preview-workflow') {
                var cell = window.my_panel.cell;
                cell.clear_input();
                cell.set_text('%preview --workflow');
                cell.clear_output();
                cell.output_area.append_output({
                    'output_type': 'stream',
                    'text': data,
                    'name': 'stdout'
                });
            } else if (msg_type == 'tasks-pending') {
                // console.log(data);
                /* we record the pending tasks of cells so that we could
                   rerun cells once all tasks have been completed */
                /* let us get a more perminant id for cell so that we
                   can still locate the cell once its tasks are completed. */
                var cell = IPython.notebook.get_cell(data[0]);
                window.pending_cells[cell.cell_id] = data[1];
            } else if (msg_type == 'remove-task') {
                var item = document.getElementById("table_" + data[0] + "_" + data[1]);
                item.parentNode.removeChild(item);
            } else if (msg_type == 'update-duration') {
                if (window._duration_updater === undefined) {
                    window._duration_updater = window.setInterval(function() {
                        $('[id^=duration_]').text(function() {
                            return durationFormatter($(this).attr('datetime'));
                        })
                    }, 5000);
                }
            } else if (msg_type == 'task-status') {
                // console.log(data);
                var item = document.getElementById("status_" + data[0] + "_" + data[1]);
                if (!item)
                    return;
                else {
                    // id, status, status_class, action_class, action_func
                    item.className = "fa fa-fw fa-2x " + data[3];
                    item.setAttribute('onmouseover', "$('#status_" + data[0] + "_" + data[1] + "').addClass('" + data[4] + "').removeClass('" + data[3] + "')");
                    item.setAttribute('onmouseleave', "$('#status_" + data[0] + "_" + data[1] + "').addClass('" + data[3] + "').removeClass('" + data[4] + "')");
                    item.setAttribute("onClick", data[5] + '("' + data[1] + '", "' + data[0] + '")');
                }
                if (data[2] === "completed") {
                    /* if successful, let us re-run the cell to submt another task
                       or get the result */
                    for (cell in window.pending_cells) {
                        /* remove task from pending_cells */
                        var idx = window.pending_cells[cell].indexOf(data[1]);
                        // $("#"+data[0]).css("background-color","#98FB98")
                        if (idx >= 0) {
                            window.pending_cells[cell].splice(idx, 1);
                            if (window.pending_cells[cell].length === 0) {
                                delete window.pending_cells[cell];
                                /* if the does not have any pending one, re-run it. */
                                var cells = IPython.notebook.get_cells();
                                var rerun = null;
                                for (var i = 0; i < cells.length; ++i) {
                                    if (cells[i].cell_id == cell) {
                                        rerun = cells[i];
                                        break;
                                    }
                                }
                                if (rerun) {
                                    window._auto_resume = true;
                                    rerun.execute();
                                }
                            }
                        }
                    }
                }
            } else if (msg_type == 'resource-plot') {
                // get the item
                console.log('Update ' + data[0]);
                // parent element is a table cell, needs enlarge
                document.getElementById(data[0]).parentElement.setAttribute("height", "300px;");
                $('#' + data[0]).css("height", "300px");
                $('#' + data[0]).css("width", "100%");
                $('#' + data[0]).css("min-height", "300px");

                var cpu = [];
                var mem = [];
                for (var i = 0; i < data[1].length; i++) {
                    // python time * 1000 equals JS milliseconds
                    cpu.push([data[1][i] * 1000, data[2][i]]);
                    mem.push([data[1][i] * 1000, data[3][i]]);
                }

                function loadFiles(files, fn) {
                    if (!files.length) {
                        files = [];
                    }
                    var head = document.head || document.getElementsByTagName('head')[0];

                    function loadFile(index) {
                        if (files.length > index) {
                            var fileref = document.createElement('script');
                            fileref.setAttribute("type", "text/javascript");
                            fileref.setAttribute("src", files[index]);
                            head.appendChild(fileref);
                            index = index + 1;
                            // Used to call a callback function
                            fileref.onload = function() {
                                loadFile(index);
                            }
                        } else if (fn) {
                            fn();
                        }
                    }
                    loadFile(0);
                }

                //$.getScript("http://www.flotcharts.org/flot/jquery.flot.js", function() {
                loadFiles(["http://www.flotcharts.org/flot/jquery.flot.js",
                    "http://www.flotcharts.org/flot/jquery.flot.time.js"
                ], function() {
                    $.plot('#' + data[0], [{
                            data: cpu,
                            label: "CPU (%)"
                        },
                        {
                            data: mem,
                            label: "mem (M)",
                            yaxis: 2
                        }
                    ], {
                        xaxes: [{
                            mode: "time"
                        }],
                        yaxes: [{
                            min: 0
                        }, {
                            position: "right",
                            tickFormatter: function(v, axis) {
                                return v.toFixed(1) + 'M';
                            }
                        }],
                        legend: {
                            position: "nw"
                        }
                    });
                });
            } else if (msg_type == 'show_toc') {
                show_toc();
            } else {
                // this is preview output
                var cell = window.my_panel.cell;
                data.output_type = msg_type;
                cell.output_area.append_output(data);
            }
            adjustPanel();
        });
        window.sos_comm.send({
            'list-kernel': true,
            'update-task-status': window.unknown_tasks,
        })
        console.log('sos comm registered');
    }

    function send_kernel_msg(msg) {
        window.sos_comm.send(msg);
    }

    function request_kernel_list() {
        if (!window.kernel_updated) {
            // Use comm communication to request kernel list, instead of sending
            // an evaluation request.
            //
            // IPython.notebook.kernel.execute('%frontend --list-kernel', [], {
            //    'silent': true,
            //    'store_history': false
            // });
            send_kernel_msg({
                'list-kernel': true,
            });
            console.log('kernel list requested');
        }
    }

    function wrap_execute() {
        // override kernel execute with the wrapper.
        // however, this function can be called multiple times for kernel
        // restart etc, so we should be careful
        if (IPython.notebook.kernel.orig_execute === undefined) {
            IPython.notebook.kernel.orig_execute = IPython.notebook.kernel.execute;
            IPython.notebook.kernel.execute = my_execute;
            console.log('executor patched');
        }
    }


    function get_workflow_from_cell(cell) {
        var lines = cell.get_text().split('\n');
        var workflow = '';
        for (var l = 0; l < lines.length; ++l) {
            if (lines[l].startsWith('%include') || lines[l].startsWith('%from')) {
                workflow += lines[l] + '\n';
                continue
            } else if (lines[l].startsWith('#') || lines[l].startsWith('%') || lines[l].trim() == '' || lines[l].startsWith('!')) {
                continue
            } else if (lines[l].startsWith('[') && lines[l].endsWith(']')) {
                workflow += lines.slice(l).join('\n') + '\n\n';
            }
            break;
        }
        return workflow;
    }

    function changeStyleOnKernel(cell, type) {
        var sel = cell.element[0].getElementsByTagName('select')[0]
        var opts = sel.options;
        for (var opt, j = 0; opt = opts[j]; j++) {
            if (opt.value == DisplayName[type]) {
                sel.selectedIndex = j;
                break;
            }
        }
        // cell in panel does not have prompt area
        var col = '';
        if (cell.is_panel !== undefined) {
            if (BackgroundColor[type]) {
                col = BackgroundColor[type];
            }
            cell.element[0].getElementsByClassName('input')[0].style.backgroundColor = col;
            return col;
        }

        var ip = cell.element[0].getElementsByClassName('input_prompt');
        var op = cell.element[0].getElementsByClassName('out_prompt_overlay');

        if (type == 'sos' && get_workflow_from_cell(cell)) {
            col = '#F0F0F0';
        } else if (BackgroundColor[type]) {
            col = BackgroundColor[type];
        }
        ip[0].style.backgroundColor = col;
        op[0].style.backgroundColor = col;
        return col;
    }

    window.kill_task = function(task_id, task_queue) {
        console.log('Kill ' + task_id);
        send_kernel_msg({
            'kill-task': [task_id, task_queue],
        });
    }

    window.resume_task = function(task_id, task_queue) {
        console.log('Resume ' + task_id);
        send_kernel_msg({
            'resume-task': [task_id, task_queue],
        });
    }

    window.task_info = function(task_id, task_queue) {
        console.log('Request info on ' + task_id);
        send_kernel_msg({
            'task-info': [task_id, task_queue],
        });
        var cell = window.my_panel.cell;
        cell.clear_input();
        cell.set_text('%taskinfo ' + task_id + ' -q ' + task_queue);
        cell.clear_output();
    }

    window.durationFormatter = function(start_date) {
        var ms = new Date() - start_date;
        var res = []
        var seconds = parseInt(ms / 1000);
        var day = Math.floor(seconds / 86400);
        if (day > 0)
            res.push(day + ' day');
        var hh = Math.floor((seconds % 86400) / 3600);
        if (hh > 0)
            res.push(hh + ' hr');
        var mm = Math.floor((seconds % 3600) / 60);
        if (mm > 0)
            res.push(mm + ' min');
        var ss = seconds % 60;
        if (ss > 0)
            res.push(ss + ' sec');
        res = res.join(' ');
        if (res === '')
            return '0 sec'
        else
            return res;
    };

    function set_codemirror_option(evt, param) {
        var cells = IPython.notebook.get_cells();
        for (var i = cells.length - 1; i >= 0; --i)
            cells[i].code_mirror.setOption('styleActiveLine', cells[i].selected);
        return true;
    }

    function load_select_kernel() {
        // this function will be called twice, the first time when the notebook is loaded
        // to create UT elements using the information from notebook metadata. The second
        // time will be caused whent the backend sends the frontend a list of available kernels
        // this is why we should not add additional UI elements when the function is called
        // the second time.

        //change css for CellToolBar
        var load_css = function() {
            var css = document.createElement("style");
            css.type = "text/css";
            css.innerHTML = '.code_cell .celltoolbar {' +
                'width:70pt;background:none;border:none;border-bottom:none;z-index: 1000;' +
                'position:relative;margin-bottom:-50pt;float:right;}  ' +
                '.text_cell .celltoolbar {display:none}  ';
            document.body.appendChild(css);
        };

        load_css();

        var CellToolbar = IPython.CellToolbar;
        // the cell tool bar might have been added by the previous load_select_kernel call
        var slideshow_preset = [];
        var select_type = CellToolbar.utils.select_ui_generator(
            KernelList,
            // setter
            function(cell, value) {
                // we check that the slideshow namespace exist and create it if needed
                //if (cell.metadata.kernel == undefined) {
                cell.metadata.kernel = KernelName[value];
                // cell in panel does not have prompt area
                if (cell.is_panel !== undefined) {
                    if (BackgroundColor[value])
                        cell.element[0].getElementsByClassName('input')[0].style.backgroundColor = BackgroundColor[value];
                    else
                        cell.element[0].getElementsByClassName('input')[0].style.backgroundColor = '';
                    return;
                }

                var ip = cell.element[0].getElementsByClassName('input_prompt');
                var op = cell.element[0].getElementsByClassName('out_prompt_overlay');
                if (BackgroundColor[value]) {
                    ip[0].style.backgroundColor = BackgroundColor[value];
                    op[0].style.backgroundColor = BackgroundColor[value];
                } else {
                    // Use '' to remove background-color?
                    ip[0].style.backgroundColor = '';
                    op[0].style.backgroundColor = '';
                }
            },
            //geter
            function(cell) {
                var ns = cell.metadata.kernel;
                return (ns == undefined) ? undefined : ns.kernel
            },
            "");

        if (CellToolbar.list_presets().indexOf("Select cell kernel") > 0)
            CellToolbar.unregister_preset('Select cell kernel');
        CellToolbar.register_callback('slideshow.select', select_type);
        slideshow_preset.push('slideshow.select');
        var reveal_preset = slideshow_preset.slice();
        CellToolbar.register_preset('Select cell kernel', reveal_preset);
        // console.log('Select cell kernel loaded.');
        CellToolbar.global_show();
        CellToolbar.activate_preset('Select cell kernel');

        var cells = IPython.notebook.get_cells();
        for (var i in cells) {
            if (cells[i].cell_type == 'code') {
                changeStyleOnKernel(cells[i], cells[i].metadata.kernel);
            }
        }

        var dropdown = $("<select></select>").attr("id", "kernel_selector")
            .css("margin-left", "0.75em")
            .attr("class", "form-control select-xs")
        // .change(select_kernel);
        if (Jupyter.toolbar.element.has('#kernel_selector').length == 0)
            Jupyter.toolbar.element.append(dropdown);
        // remove any existing items
        $('#kernel_selector').empty();
        $.each(KernelList, function(key, value) {
            $('#kernel_selector')
                .append($("<option></option>")
                    .attr("value", DisplayName[value[0]])
                    .text(DisplayName[value[0]]));
        });
        $('#kernel_selector').val("SoS");
        $('#kernel_selector').change(function() {
            var kernel_type = $("#kernel_selector").val();

            window.default_kernel = kernel_type;

            var cells = IPython.notebook.get_cells();
            for (var i in cells) {
                if (cells[i].cell_type == 'code' && !cells[i].metadata.kernel) {
                    changeStyleOnKernel(cells[i], kernel_type);
                }
            }
        });
    }

    function changeCellStyle() {
        var cells = IPython.notebook.get_cells();
        // setting up background color and selection according to notebook metadata
        for (var i in cells) {
            if (cells[i].cell_type == 'code') {
                changeStyleOnKernel(cells[i], cells[i].metadata.kernel);
            }
        }
        $('[id^=status_]').removeAttr('onClick').removeAttr('onmouseover').removeAttr('onmouseleave');
        var tasks = $('[id^=status_]');
        window.unknown_tasks = [];
        for (var i = 0; i < tasks.length; ++i) {
            // status_localhost_5ea9232779ca19591819072642646d16
            if (tasks[i].id.match('^status_[^_]+_[0-9a-f]{32}$')) {
                tasks[i].className = 'fa fa-fw fa-2x fa-refresh fa-spin';
                window.unknown_tasks.push(tasks[i].id);
            }
        }
    }


    function incr_lbl(ary, h_idx) { //increment heading label  w/ h_idx (zero based)
        ary[h_idx]++;
        for (var j = h_idx + 1; j < ary.length; j++) {
            ary[j] = 0;
        }
        return ary.slice(0, h_idx + 1);
    }

    function removeMathJaxPreview(elt) {
        elt.find("script[type='math/tex']").each(
            function(i, e) {
                $(e).replaceWith('$' + $(e).text() + '$')
            })
        elt.find("span.MathJax_Preview").remove()
        elt.find("span.MathJax").remove()
        return elt
    }


    function highlight_toc_item(evt, data) {
        if ($('.toc').length === 0)
            return;
        var c = data.cell.element; //
        if (c) {
            var ll = $(c).find(':header')
            if (ll.length == 0) {
                var ll = $(c).prevAll().find(':header')
            }
            var elt = ll[ll.length - 1]
            if (elt) {
                var highlighted_item = $('.toc').find('a[href="#' + elt.id + '"]')
                if (evt.type == "execute") {
                    // remove the selected class and add execute class
                    // il the cell is selected again, it will be highligted as selected+running
                    highlighted_item.removeClass('toc-item-highlight-select').addClass('toc-item-highlight-execute')
                    //console.log("->>> highlighted_item class",highlighted_item.attr('class'))
                } else {
                    $('.toc').find('.toc-item-highlight-select').removeClass('toc-item-highlight-select')
                    highlighted_item.addClass('toc-item-highlight-select')
                }
            }
        }
    }


    var make_link = function(h) {
        var a = $("<a/>");
        a.attr("href", '#' + h.attr('id'));
        // get the text *excluding* the link text, whatever it may be
        var hclone = h.clone();
        hclone = removeMathJaxPreview(hclone);
        hclone.children().last().remove(); // remove the last child (that is the automatic anchor)
        hclone.find("a[name]").remove(); //remove all named anchors
        a.html(hclone.html());
        a.on('click', function() {
            setTimeout(function() {
                $.ajax()
            }, 100); //workaround for  https://github.com/jupyter/notebook/issues/699
            IPython.notebook.get_selected_cell().unselect(); //unselect current cell
            var new_selected_cell = $("[id='" + h.attr('id') + "']").parents('.unselected').switchClass('unselected', 'selected')
            new_selected_cell.data('cell').selected = true;
            var cell = new_selected_cell.data('cell') // IPython.notebook.get_selected_cell()
            highlight_toc_item("toc_link_click", {
                cell: cell
            });
        })
        return a;
    };


    var table_of_contents = function() {

        //process_cell_toc();

        var toc = $('<div class="toc"/>');
        var ul = $("<ul/>").addClass("toc-item").addClass("lev1").attr('id', 'toc-level0');
        toc.append(ul);
        var depth = 1; //var depth = ol_depth(ol);
        var li = ul; //yes, initialize li with ul! 
        var all_headers = $("#notebook").find(":header");
        var min_lvl = 1,
            lbl_ary = [];
        for (; min_lvl <= 6; min_lvl++) {
            if (all_headers.is('h' + min_lvl)) {
                break;
            }
        }
        for (var i = min_lvl; i <= 6; i++) {
            lbl_ary[i - min_lvl] = 0;
        }

        //loop over all headers
        all_headers.each(function(i, h) {
            var level = parseInt(h.tagName.slice(1), 10) - min_lvl + 1;
            // skip headings with no ID to link to
            if (!h.id) {
                return;
            }
            //If h had already a number, remove it
            /* $(h).find(".toc-item-num").remove(); */
            var num_str = incr_lbl(lbl_ary, level - 1).join('.'); // numbered heading labels
            //var num_lbl = $("<span/>").addClass("toc-item-num")
            //    .text(num_str).append('&nbsp;').append('&nbsp;');

            // walk down levels
            for (var elm = li; depth < level; depth++) {
                var new_ul = $("<ul/>").addClass("lev" + (depth + 1).toString()).addClass("toc-item");
                elm.append(new_ul);
                elm = ul = new_ul;
            }
            // walk up levels
            for (; depth > level; depth--) {
                // up twice: the enclosing <ol> and <li> it was inserted in
                ul = ul.parent();
                while (!ul.is('ul')) {
                    ul = ul.parent();
                }
            }
            // Change link id -- append current num_str so as to get a kind of unique anchor 
            // A drawback of this approach is that anchors are subject to change and thus external links can fail if toc changes
            // Anyway, one can always add a <a name="myanchor"></a> in the heading and refer to that anchor, eg [link](#myanchor) 
            // This anchor is automatically removed when building toc links. The original id is also preserved and an anchor is created 
            // using it. 
            // Finally a heading line can be linked to by [link](#initialID), or [link](#initialID-num_str) or [link](#myanchor)
            h.id = h.id.replace(/\$/g, '').replace('\\', '')
            if (!$(h).attr("saveid")) {
                $(h).attr("saveid", h.id)
            } //save original id
            h.id = $(h).attr("saveid") + '-' + num_str.replace(/\./g, '');
            // change the id to be "unique" and toc links to it 
            // (and replace '.' with '' in num_str since it poses some pb with jquery)
            var saveid = $(h).attr('saveid')
            //escape special chars: http://stackoverflow.com/questions/3115150/
            var saveid_search = saveid.replace(/[-[\]{}():\/!;&@=$£%§<>%"'*+?.,~\\^$|#\s]/g, "\\$&");
            if ($(h).find("a[name=" + saveid_search + "]").length == 0) { //add an anchor with original id (if it doesnt't already exists)
                $(h).prepend($("<a/>").attr("name", saveid));
            }


            // Create toc entry, append <li> tag to the current <ol>. Prepend numbered-labels to headings.
            li = $("<li/>").append(make_link($(h)));

            ul.append(li);
            // $(h).prepend(num_lbl);
        });
        return toc;
    };

    var create_panel_div = function() {
        var panel_wrapper = $('<div id="panel-wrapper"/>')
            .append(
                $("<div/>").attr("id", "panel").addClass('panel')
            )

        $("body").append(panel_wrapper);

        $([Jupyter.events]).on("resize-header.Page", function() {
            if (IPython.notebook.metadata['sos']['panel'].style === 'side') {
                $('#panel-wrapper').css('top', $('#header').height())
                $('#panel-wrapper').css('height', $('#site').height());
            }
        });
        $([Jupyter.events]).on("toggle-all-headers", function() {
            if (IPython.notebook.metadata['sos']['panel'].style === 'side') {
                var headerVisibleHeight = $('#header').is(':visible') ? $('#header').height() : 0
                $('#panel-wrapper').css('top', headerVisibleHeight)
                $('#panel-wrapper').css('height', $('#site').height());
            }
        });

        // enable dragging and save position on stop moving
        $('#panel-wrapper').draggable({

            drag: function(event, ui) {

                // If dragging to the left side, then transforms in sidebar
                if ((ui.position.left <= 0) && (IPython.notebook.metadata['sos']['panel'].style === 'float')) {
                    IPython.notebook.metadata['sos']['panel'].style = 'side';
                    IPython.notebook.metadata['sos']['panel'].height = $('#panel-wrapper').css('height');
                    panel_wrapper.removeClass('float-wrapper').addClass('sidebar-wrapper');
                    $('#notebook-container').css('margin-left', $('#panel-wrapper').width() + 30);
                    $('#notebook-container').css('width', $('#notebook').width() - $('#panel-wrapper').width() - 30);
                    ui.position.top = $('#header').height();
                    ui.position.left = 0;
                    $('#panel-wrapper').css('height', $('#site').height());
                }
                if (ui.position.left <= 0) {
                    ui.position.left = 0;
                    ui.position.top = $('#header').height();
                }
                if ((ui.position.left > 0) && (IPython.notebook.metadata['sos']['panel'].style === 'side')) {
                    IPython.notebook.metadata['sos']['panel'].style = 'float';
                    if (IPython.notebook.metadata['sos']['panel'].height == 0)
                        IPython.notebook.metadata['sos']['panel'].height = Math.max($('#site').height() / 2, 200)
                    $('#panel-wrapper').css('height', IPython.notebook.metadata['sos']['panel'].height);
                    panel_wrapper.removeClass('sidebar-wrapper').addClass('float-wrapper');
                    $('#notebook-container').css('margin-left', 30);
                    $('#notebook-container').css('width', $('#notebook').width() - 30);
                }

            }, //end of drag function
            start: function(event, ui) {
                $(this).width($(this).width());
            },
            stop: function(event, ui) {
                // Ensure position is fixed (again)
                $('#panel-wrapper').css('position', 'fixed');
            },
            // can only drag from the border, not the panel and the cell. This
            // allows us to, for example, copy/paste output area.
            cancel: "#panel, #input"
        });

        $('#panel-wrapper').resizable({
            resize: function(event, ui) {
                if (IPython.notebook.metadata['sos']['panel'].style === 'side') {
                    $('#notebook-container').css('margin-left', $('#panel-wrapper').width() + 30)
                    $('#notebook-container').css('width', $('#notebook').width() - $('#panel-wrapper').width() - 30)
                }
            },
            start: function(event, ui) {
                $(this).width($(this).width());
                //$(this).css('position', 'fixed');
            },
        })

        // Ensure position is fixed
        $('#panel-wrapper').css('position', 'fixed');

        // if panel-wrapper is undefined (first run(?), then hide it)
        // if ($('#panel-wrapper').css('display') == undefined) $('#panel-wrapper').css('display', "none") //block
        if ($('#panel-wrapper').css('display') == undefined) $('#panel-wrapper').css('display', "block") //block
        $('#site').bind('siteHeight', function() {
            $('#panel-wrapper').css('height', $('#site').height());
        })

        $('#site').trigger('siteHeight');


        if (IPython.notebook.metadata['sos']['panel'].style === 'side') {
            $('#panel-wrapper').addClass('sidebar-wrapper');
            setTimeout(function() {
                $('#notebook-container').css('width', $('#notebook').width() - $('#panel-wrapper').width() - 30);
                $('#notebook-container').css('margin-left', $('#panel-wrapper').width() + 30);
            }, 500)
            setTimeout(function() {
                $('#panel-wrapper').css('height', $('#site').height());
            }, 500)
            setTimeout(function() {
                $('#panel-wrapper').css('top', $('#header').height());
            }, 500) //wait a bit
            $('#panel-wrapper').css('left', 0);

        }


        $(window).resize(function() {
            $('#panel').css({
                maxHeight: $(window).height() - 30
            });
            $('#panel-wrapper').css({
                maxHeight: $(window).height() - 10
            });

            if (IPython.notebook.metadata['sos']['panel'].style === 'side') {
                if ($('#panel-wrapper').css('display') != 'block') {
                    $('#notebook-container').css('margin-left', 30);
                    $('#notebook-container').css('width', $('#notebook').width() - 30);
                } else {
                    $('#notebook-container').css('margin-left', $('#panel-wrapper').width() + 30);
                    $('#notebook-container').css('width', $('#notebook').width() - $('#panel-wrapper').width() - 30);
                    $('#panel-wrapper').css('height', $('#site').height());
                    $('#panel-wrapper').css('top', $('#header').height());
                }
            } else {
                $('#notebook-container').css('margin-left', 30);
                $('#notebook-container').css('width', $('#notebook').width() - 30);
            }
        });
        $(window).trigger('resize');
    }



    var panel = function(nb) {
        var panel = this;
        this.notebook = nb;
        this.kernel = nb.kernel;
        this.km = nb.keyboard_manager;

        create_panel_div();
        console.log('panel created');

        // create my cell
        var cell = this.cell = new CodeCell(nb.kernel, {
            events: nb.events,
            config: nb.config,
            keyboard_manager: nb.keyboard_manager,
            notebook: nb,
            tooltip: nb.tooltip,
        });
        cell.set_input_prompt();
        cell.is_panel = true;
        $("#panel").append(this.cell.element);

        cell.render();
        cell.refresh();
        this.cell.element.hide();

        /*
        // move input prompt on top of the cell
        var panel_buttons = $('<div class="panel_buttons"/>');
        panel_buttons.append(
            $("<a/>").attr('href', '#')
            .append($("<i class='fa fa-book'></i>"))
            .click(function() {
                var win = window.open('http://vatlab.github.io/SOS/doc/documentation/Notebook_Interface.html', '_blank');
                win.focus();
                return false;
            })
        ).append(
            $("<span/>")
            .html("&nbsp;&nbsp")
        ).append(
            $("<a/>").attr('href', '#')
            .append($("<i class='fa fa-list-ul'></i>"))
            .click(function() {
                show_toc();
                return false;
            })
        ).append(
            $("<span/>")
            .html("&nbsp;&nbsp")
        ).append(
            $("<a/>").attr('href', '#')
            .append($("<i class='fa  fa-tasks'></i>"))
            .click(function() {
                var panel_cell = window.my_panel.cell;
                panel_cell.clear_input();
                panel_cell.set_text('%tasks');
                panel_cell.clear_output();
                panel_cell.execute();
                return false;
            })
        ).append(
            $("<span/>")
            .html("&nbsp;&nbsp")
        ).append(
            $("<a/>").attr('href', '#')
            .append($("<i class='fa fa-file-text'></i>"))
            .click(function() {
                var panel_cell = window.my_panel.cell;
                panel_cell.clear_input();
                panel_cell.set_text('%preview --workflow');
                panel_cell.clear_output();
                panel_cell.execute();
                return false;
            })
        ).append(
            $("<span/>")
            .html("&nbsp;&nbsp")
        ).append(
            $("<a/>").attr('href', '#').attr('id', 'history_icon')
            .append($("<i class='fa fa-history'></i>"))
            .click(function() {
                var dropdown = $('#panel_history');
                var len = $('#panel_history option').length;
                if (len === 0)
                    return false;
                if (dropdown.css('display') === 'none') {
                    dropdown.show();
                    dropdown[0].size = len;
                    setTimeout(function() {
                        dropdown.hide()
                    }, 8000);
                } else {
                    dropdown.hide();
                }
                return false;
            })

        ).append(
            $("<select></select>").attr("id", "panel_history")
            .css("margin-left", "0.75em").css('position', 'fixed').css('display', 'none')
            .change(function() {
                var item = $('#panel_history').val();
                // separate kernel and input
                var sep = item.indexOf(':');
                var kernel = item.substring(0, sep);
                var text = item.substring(sep + 1);

                var panel_cell = window.my_panel.cell;
                $('#panel_history').hide();

                // set the kernel of the panel cell as the sending cell
                if (panel_cell.metadata.kernel !== kernel) {
                    panel_cell.metadata.kernel = kernel;
                    changeStyleOnKernel(panel_cell, kernel);
                }

                panel_cell.clear_input();
                panel_cell.set_text(text);
                panel_cell.clear_output();
                panel_cell.execute();
                return false;
            })
        )
        */

        this.cell.element.find('div.input_prompt').css('min-width', '0ex').css('width', '0ex').text('In [-]:');
        this.cell.element.find('div.input_area')
            .append(
                $("<a/>").attr('href', '#').attr('id', 'input_dropdown').addClass('input_dropdown')
                .append($("<i class='fa fa-caret-down'></i>"))
                .click(function() {
                    var dropdown = $('#panel_history');
                    var len = $('#panel_history option').length;
                    if (len === 0)
                        return false;
                    if (dropdown.css('display') === 'none') {
                        dropdown.show();
                        dropdown[0].size = len;
                        setTimeout(function() {
                            dropdown.hide()
                        }, 8000);
                    } else {
                        dropdown.hide();
                    }
                    return false;
                })
            ).parent().append(
                $("<select></select>").attr("id", "panel_history").addClass('panel_history')
                .change(function() {
                    var item = $('#panel_history').val();
                    // separate kernel and input
                    var sep = item.indexOf(':');
                    var kernel = item.substring(0, sep);
                    var text = item.substring(sep + 1);

                    var panel_cell = window.my_panel.cell;
                    $('#panel_history').hide();

                    // set the kernel of the panel cell as the sending cell
                    if (panel_cell.metadata.kernel !== kernel) {
                        panel_cell.metadata.kernel = kernel;
                        changeStyleOnKernel(panel_cell, kernel);
                    }
                    panel_cell.clear_input();
                    panel_cell.set_text(text);
                    panel_cell.clear_output();
                    panel_cell.execute();
                    return false;
                })
            )

        add_to_panel_history('sos', '%toc', '');
        add_to_panel_history('sos', '%preview --workflow', '');
        add_to_panel_history('sos', '%tasks', '');

        // move the language selection stuff to the top
        this.cell.element[0].getElementsByClassName('celltoolbar')[0].style.marginBottom = 0;
        // this would allow us to insert lable or title to the left of language dropdown
        this.cell.element[0].getElementsByClassName('celltoolbar')[0].style.width = '100%';
        // make the font of the panel slightly smaller than the main notebook
        // unfortunately the code mirror input cell has fixed font size that cannot
        // be changed.
        this.cell.element[0].style.fontSize = '90%';
        console.log('panel rendered');

        // override ctrl/shift-enter to execute me if I'm focused instead of the notebook's cell
        var execute_and_select_action = this.km.actions.register({
            handler: $.proxy(this.execute_and_select_event, this),
        }, 'panel-execute-and-select');
        var execute_action = this.km.actions.register({
            handler: $.proxy(this.execute_event, this),
        }, 'panel-execute');
        var toggle_action = this.km.actions.register({
            handler: $.proxy(toggle_panel, this),
        }, 'panel-toggle');

        var execute_selected_in_panel = this.km.actions.register({
            help: 'run selected text in panel cell',
            handler: execute_in_panel,
        }, 'execute-selected');
        var show_toc_in_panel = this.km.actions.register({
            help: 'show toc in panel',
            handler: show_toc,
        }, 'show-toc');
        var shortcuts = {
            'shift-enter': execute_and_select_action,
            'ctrl-enter': execute_action,
            'ctrl-b': toggle_action,
            // It is very strange to me that other key bindings such as
            // Ctrl-e does not work as it will somehow make the
            // code_mirror.getSelection() line getting only blank string.
            'ctrl-shift-enter': execute_selected_in_panel,
            'ctrl-shift-t': show_toc_in_panel,
        }
        this.km.edit_shortcuts.add_shortcuts(shortcuts);
        this.km.command_shortcuts.add_shortcuts(shortcuts);

        this.cell.element.show();
        this.cell.focus_editor();
        IPython.notebook.metadata['sos']['panel'].displayed = true;
        console.log('display panel');
    };


    panel.prototype.execute_and_select_event = function(evt) {
        // if we execute statements before the kernel is wrapped
        // from other channels (update kernel list etc), wrap it now.
        wrap_execute();

        if (utils.is_focused(this.cell.element)) {
            this.cell.execute();
        } else {
            this.notebook.execute_cell_and_select_below();
        }
    };

    panel.prototype.execute_event = function(evt) {
        // if we execute statements before the kernel is wrapped
        // from other channels (update kernel list etc), wrap it now.
        wrap_execute();

        if (utils.is_focused(this.cell.element)) {
            this.cell.execute();
        } else {
            this.notebook.execute_selected_cells();
        }
    };

    var add_to_panel_history = function(kernel, text, col) {
        // console.log('add ' + kernel + ' ' + col);
        var matched = false;
        $('#panel_history option').each(function(index, element) {
            if (element.value == kernel + ':' + text) {
                matched = true;
                return false;
            }
        })
        if (!matched) {
            $('#panel_history').append($('<option></option>')
                    .css('background-color', col)
                    .attr('value', kernel + ":" + text).text(text.split("\n").join(' .. ').truncate(40))
                )
                .prop("selectedIndex", -1);
        }
    }

    String.prototype.truncate = function() {
        var re = this.match(/^.{0,25}[\S]*/);
        var l = re[0].length;
        var re = re[0].replace(/\s$/, '');
        if (l < this.length)
            re = re + "...";
        return re;
    }

    var execute_in_panel = function(evt) {
        //var cell = IPython.notebook.get_selected_cell();
        var cell = evt.notebook.get_selected_cell();
        if (cell.cell_type != 'code')
            return false;
        var text = cell.code_mirror.getSelection();
        if (text === "") {
            // get current line and move the cursor to the next line
            var cm = cell.code_mirror;
            var line_ch = cm.getCursor();
            var cur_line = line_ch["line"];
            text = cm.getLine(cur_line);
            // jump to the next non-empty line
            var line_cnt = cm.lineCount();
            while (++cur_line < line_cnt) {
                if (cm.getLine(cur_line).replace(/^\s+|\s+$/gm, '').length != 0) {
                    cell.code_mirror.setCursor(cur_line, line_ch["ch"]);
                    break;
                }
            }
        }
        if (!IPython.notebook.metadata['sos']['panel'].displayed)
            toggle_panel();
        //
        var panel_cell = window.my_panel.cell;
        // set the kernel of the panel cell as the sending cell
        var col = cell.element[0].getElementsByClassName('input_prompt')[0].style.backgroundColor;
        if (panel_cell.metadata.kernel !== cell.metadata.kernel) {
            panel_cell.metadata.kernel = cell.metadata.kernel;
            col = changeStyleOnKernel(panel_cell, panel_cell.metadata.kernel);
        }
        // if in sos mode and is single line, enable automatic preview
        if ((cell.metadata.kernel == 'sos' || cell.metadata.kernel === undefined) && text.indexOf('\n') == -1 && text.indexOf('%') !== 0) {
            // if it is expression without space
            if (text.indexOf('=') == -1) {
                if (text.indexOf(' ') == -1)
                    text = '%preview ' + text;
            } else {
                var varname = text.substring(0, text.indexOf('=')).trim();
                if (varname.indexOf(' ') == -1)
                    text = '%preview ' + varname + '\n' + text;
            }
        }
        panel_cell.clear_input();
        panel_cell.set_text(text);
        panel_cell.clear_output();
        add_to_panel_history(panel_cell.metadata.kernel, text, col);
        panel_cell.execute();
        return false;
    };

    var show_toc = function(evt) {
        var cell = window.my_panel.cell;
        cell.clear_input();
        cell.set_text('%toc')
        cell.clear_output();
        var toc = cell.output_area.create_output_area().append(table_of_contents());
        cell.output_area._safe_append(toc);
        adjustPanel();
    }

    var update_toc = function(evt, data) {
        if ($('.toc').length != 0) {
            show_toc();
            highlight_toc_item(evt, data);
        }
    }

    function setup_panel() {
        // lazy, hook it up to Jupyter.notebook as the handle on all the singletons
        console.log("Setting up panel");
        window.my_panel = new panel(Jupyter.notebook);
    }

    function toggle_panel() {
        // toggle draw (first because of first-click behavior)
        //$("#panel-wrapper").toggle({'complete':function(){
        $("#panel-wrapper").toggle({
            'progress': function() {
                if ($('#panel-wrapper').css('display') != 'block' && $('#toc-wrapper').css('display') != 'block') {
                    $('#notebook-container').css('margin-left', 15);
                    $('#notebook-container').css('width', $('#site').width());
                } else {
                    $('#notebook-container').css('margin-left', $('#panel-wrapper').width() + 30)
                    $('#notebook-container').css('width', $('#notebook').width() - $('#panel-wrapper').width() - 30)
                }
            },
            'complete': function() {
                IPython.notebook.metadata['sos']['panel'].displayed = $('#panel-wrapper').css('display') === 'block'
                if (IPython.notebook.metadata['sos']['panel'].displayed) {
                    console.log("panel open toc close")
                    window.my_panel.cell.focus_editor();
                    $('#toc-wrapper').css('display', 'none')
                    $('#toc-wrapper').css('z-index', 5)
                    $('#panel-wrapper').css('z-index', 10)
                } else if ($("#toc-wrapper").css('display') === 'block') {
                    $('#toc-wrapper').css('z-index', 5)
                    $('#panel-wrapper').css('z-index', 10)
                    $('#panel-wrapper').css('display', 'block')
                    $('#panel-wrapper').css('display', 'none')
                    $('#notebook-container').css('margin-left', $('#panel-wrapper').width() + 30)
                    $('#notebook-container').css('width', $('#notebook').width() - $('#panel-wrapper').width() - 30)


                }
            }
        });
    }

    function load_panel() {

        var load_css = function() {
            var css = document.createElement("style");
            css.type = "text/css";
            css.innerHTML = '.panel {' +
                '  padding: 0px;' +
                '  overflow-y: auto;' +
                '  font-weight: normal;' +
                '  color: #333333;' +
                '  white-space: nowrap;' +
                '  overflow-x: auto;' +
                '  height: 100%;' +
                '} ' +
                '' +
                '.float-wrapper {' +
                '  position: fixed !important;' +
                '  top: 120px;' +
                '  /* max-width:600px; */' +
                '  right: 20px;' +
                '  border: thin solid rgba(0, 0, 0, 0.38);' +
                '  border-radius: 5px;' +
                '  padding:5px;' +
                '  padding-top:10px;' +
                '  background-color: #F8F5E1;' +
                '  opacity: .8;' +
                '  z-index: 100;' +
                '  overflow: hidden;' +
                '}' +
                '' +
                '.sidebar-wrapper {' +
                '    height: 100%;' +
                '    left: 5px;' +
                '    padding: 5px;' +
                '    padding-top: 10px;' +
                '    position: fixed !important;' +
                '    width: 25%;' +
                '    max-width: 50%;' +
                '    background-color: #F8F5E1;' +
                '    border-style: solid;' +
                '    border-color: #eeeeee;' +
                '    opacity: .99;' +
                '    overflow: hidden;' +
                '}' +
                '' +
                '.col-md-9 {' +
                '  overflow:hidden;' +
                '  margin-left: 14%;' +
                '  width: 80%}' +
                '' +
                '#panel-wrapper.closed {' +
                '  min-width: 100px;' +
                '  width: auto;' +
                '  transition: width;' +
                '}' +
                '#panel-wrapper:hover{' +
                '  opacity: 1;' +
                '}' +
                '#panel-wrapper .header {' +
                '  font-size: 18px;' +
                '  font-weight: bold;' +
                '}' +
                '#panel-wrapper .hide-btn {' +
                '  font-size: 14px;' +
                '  font-family: monospace;' +
                '}' +
                '' +
                '#panel-wrapper .reload-btn {' +
                '  font-size: 14px;' +
                '  font-family: monospace;' +
                '}' +
                '' +
                '#panel-wrapper .number_sections-btn {' +
                '  font-size: 14px;' +
                '  font-family: monospace;' +
                '}' +
                '' +
                '' +
                '/* dont waste so much screen space... */' +
                '#panel-wrapper .panel-item{' +
                '  padding-left: 20px;' +
                '}' +
                '' +
                '#panel-wrapper .panel-item .panel-item{' +
                '  padding-left: 10px;' +
                '}' +
                '' +
                '.panel-item-num {' +
                '    font-style: normal;' +
                '}' +
                '' +
                '.panel-header {' +
                '    position: absolute;' +
                '    margin-left: 5pt;' +
                '    margin-top: 0.5em;' +
                '    text-align: left;' +
                '}' +
                '' +
                '#panel-wrapper .prompt.input_prompt {' +
                '    padding: 0pt;' +
                '    padding-top: 0.5em;' +
                '}' +
                '' +
                '#panel-wrapper .cell {' +
                '    padding: 0pt;' +
                '}' +
                '' +
                '#panel-wrapper .panel-item-num {' +
                '    font-style: normal;' +
                '    font-family: Georgia, Times New Roman, Times, serif;' +
                '    color: black;' +
                '}' +
                '' +
                '.toc {' +
                '  padding: 0px;' +
                '  overflow-y: auto;' +
                '  font-weight: normal;' +
                '  white-space: nowrap;' +
                '  overflow-x: auto;' +
                '}' +
                '' +
                '.toc ol.toc-item {' +
                '    counter-reset: item;' +
                '    list-style: none;' +
                '    padding: 0.1em;' +
                '  }' +
                '' +
                '.toc ol.toc-item li {' +
                '    display: block;' +
                '  }' +
                '' +
                '.toc ul.toc-item {' +
                '    list-style-type: none;' +
                '    padding: 0;' +
                '}' +
                '' +
                '.toc ol.toc-item li:before {' +
                '    font-size: 90%;' +
                '    font-family: Georgia, Times New Roman, Times, serif;' +
                '    counter-increment: item;' +
                '    content: counters(item, ".")" ";' +
                '}' +
                '.input_dropdown {' +
                '    position: absolute;' +
                '    right: 5pt;' +
                '    top: 3.5em;' +
                '    z-index: 1000;' +
                '}' +
                '' +
                '.panel_history {' +
                '    display: none;' +
                '    font-family: monospace;' +
                '}' +
                '' +
                '.toc-item-highlight-select  {background-color: Gold}' +
                '.toc-item-highlight-execute  {background-color: red}' +
                '.lev1 {margin-left: 5px}' +
                '.lev2 {margin-left: 10px}' +
                '.lev3 {margin-left: 10px}' +
                '.lev4 {margin-left: 10px}' +
                '.lev5 {margin-left: 10px}' +
                '.lev6 {margin-left: 10px}' +
                '.lev7 {margin-left: 10px}' +
                '.lev8 {margin-left: 10px}'
            document.body.appendChild(css);
        };

        load_css();

        if (Jupyter.notebook.kernel) {
            setup_panel();
        } else {
            events.on('kernel_ready.Kernel', setup_panel);
        }
    }

    function add_panel_button() {
        if (!IPython.toolbar) {
            $([IPython.events]).on("app_initialized.NotebookApp", panel_button);
            return;
        }
        if ($("#panel_button").length === 0) {
            IPython.toolbar.add_buttons_group([{
                'label': 'scratch tab',
                'icon': 'fa-cube',
                'callback': toggle_panel,
                'id': 'panel_button'
            }]);
        }
    };

    function adjustPanel() {
        if ($('#panel-wrapper').css('display') != "none" || $('#toc-wrapper').css('display') != "none") {

            var panel_width = IPython.notebook.metadata['sos']['panel'].style == 'side' ? $('#panel-wrapper').width() : 0;
            $('#notebook-container').css('margin-left', panel_width + 30);
            $('#notebook-container').css('width', $('#site').width() - panel_width - 30);
            $('.celltoolbar label').css('margin-left', 0);
            $('.celltoolbar label').css('margin-right', 0);
        }
        var cell = window.my_panel.cell;
        $('.output_area .prompt', cell.element).remove()
        $('.output_area .output_prompt', cell.element).remove()
        $('.output_wrapper .out_prompt_overlay', cell.element).remove()
        var ops = cell.element[0].getElementsByClassName('output_subarea');
        for (var op = 0; op < ops.length; op++)
            ops[op].style.maxWidth = '100%';
        // this will create output_scroll if needed.
        cell.output_area.scroll_if_long();
        var ops = cell.element[0].getElementsByClassName('output_scroll');
        if (ops.length > 0)
            ops[0].style.height = 'auto';
        cell.output_area.expand();
    }

    function patch_CodeCell_get_callbacks() {
        var previous_get_callbacks = CodeCell.prototype.get_callbacks;
        CodeCell.prototype.get_callbacks = function() {
            var that = this;
            var callbacks = previous_get_callbacks.apply(this, arguments);
            var prev_reply_callback = callbacks.shell.reply;
            callbacks.shell.reply = function(msg) {
                if (msg.msg_type === 'execute_reply') {
                    adjustPanel()
                }
                return prev_reply_callback(msg);
            };
            return callbacks;
        };
    }

    function remove_extension(extension) {
        if ($(extension).length) {
            console.log("remove " + extension)
            $(extension).remove()
        } else {
            setTimeout(function() {
                console.log("Wait 5 sec and remove" + extension)
                $(extension).remove();
            }, 5000);
        }
    }

    function remove_nbextensions() {
        // var extenstionArray=["#toc-wrapper","#nbextension-scratchpad"]
        var extenstionArray = ["#nbextension-scratchpad"]
        return Array.prototype.map.call(extenstionArray, remove_extension)
    }



    var onload = function() {

        remove_nbextensions()

        // setting up frontend using existing metadata (without executing anything)
        load_select_kernel();
        changeCellStyle();
        // if we reload the page, the cached sos_comm will be removed so we will
        // have to re-register sos_comm. In addition, we will need to notify the
        // kernel that the frontend has been refreshed so that it will create
        // another Comm object. This is done by sending another --list-kernel
        // option.
        if (IPython.notebook.kernel) {
            register_sos_comm();
            window.kernel_updated = false;
        }
        events.on('kernel_connected.Kernel', register_sos_comm);
        events.on('kernel_connected.Kernel', wrap_execute);
        events.on('rendered.MarkdownCell', update_toc);
        // I assume that Jupyter would load the notebook before it tries to connect
        // to the kernel, so kernel_connected.kernel is the right time to show toc
        // However, it is possible to load a page without rebooting the kernel so
        // a notebook_load event seems also to be necessary. It is a bit of
        // burden to run show_toc twice but hopefully this provides a more consistent
        // user experience.
        //
        events.on('notebook_loaded.Notebook', show_toc);
        events.on('kernel_connected.Kernel', show_toc);
        // #550
        // kernel_ready.Kernel
        //events.on('kernel_connected.Kernel', request_kernel_list);
        events.on('select.Cell', set_codemirror_option);
        events.on('select.Cell', highlight_toc_item);

        load_panel();
        add_panel_button();
        patch_CodeCell_get_callbacks();

        if ($("#toc_button").length !== 0) {
            $("#toc_button").click(function() {
                if ($('#panel-wrapper').css('display') === 'block' && $('#toc-wrapper').css('display') === 'block') {
                    if ($('#toc-wrapper').css('z-index') == "auto" && $('#panel-wrapper').css('z-index') == "auto") {
                        $('#toc-wrapper').css('z-index', 10)
                        $('#panel-wrapper').css('z-index', 5)
                        $('#panel-wrapper').css('display', 'none')
                    } else if (parseInt($('#toc-wrapper').css('z-index')) < parseInt($('#panel-wrapper').css('z-index'))) {
                        console.log("click on toc hide panel")
                        $('#toc-wrapper').css('z-index', 10)
                        $('#panel-wrapper').css('z-index', 5)
                        $('#panel-wrapper').css('display', 'none')
                        $('#notebook-container').css('margin-left', $('#panel-wrapper').width() + 30)
                        $('#notebook-container').css('width', $('#notebook').width() - $('#panel-wrapper').width() - 30)

                    }
                } else if ($('#panel-wrapper').css('display') === 'none' && $('#toc-wrapper').css('display') === 'none') {
                    $('#notebook-container').css('margin-left', 15);
                    $('#notebook-container').css('width', $('#site').width());
                }
            });
        }
        $("#to_markdown").click(function() {
            adjustPanel();
        });
        setTimeout(function() {
            adjustPanel();
            /* #524. syntax highlighting would be disabled after page reload. Note quite sure if this is
               a correct fix but it seems to work. */
            IPython.notebook.set_codemirror_mode('sos');
        }, 1000);


        // define SOS CodeMirror syntax highlighter
        (function(mod) {
            //if (typeof exports == "object" && typeof module == "object") // CommonJS
            // mod(require("../../lib/codemirror"));
            //else if (typeof define == "function" && define.amd) // AMD
            //  define(["../../lib/codemirror"], mod);
            //else // Plain browser env
            mod(CodeMirror);
        })(function(CodeMirror) {
            "use strict";

            function wordRegexp(words) {
                return new RegExp("^((" + words.join(")|(") + "))\\b");
            }

            var wordOperators = wordRegexp(["and", "or", "not", "is"]);
            var commonKeywords = ["as", "assert", "break", "class", "continue",
                "def", "del", "elif", "else", "except", "finally",
                "for", "from", "global", "if", "import",
                "lambda", "pass", "raise", "return",
                "try", "while", "with", "yield", "in"
            ];
            var commonBuiltins = ["abs", "all", "any", "bin", "bool", "bytearray", "callable", "chr",
                "classmethod", "compile", "complex", "delattr", "dict", "dir", "divmod",
                "enumerate", "eval", "filter", "float", "format", "frozenset",
                "getattr", "globals", "hasattr", "hash", "help", "hex", "id",
                "int", "isinstance", "issubclass", "iter", "len",
                "list", "locals", "map", "max", "memoryview", "min", "next",
                "object", "oct", "open", "ord", "pow", "property", "range",
                "repr", "reversed", "round", "set", "setattr", "slice",
                "sorted", "staticmethod", "str", "sum", "super", "tuple",
                "type", "vars", "zip", "__import__", "NotImplemented",
                "Ellipsis", "__debug__",

                'group_by', 'filetype', 'paired_with', 'for_each', 'pattern', 'dynamic',
                'pattern', 'workdir', 'concurrent', 'docker_image', 'docker_file',
                'shared', 'skip', 'sigil', 'provides', 'input',
                'output'
            ];
            CodeMirror.registerHelper("hintWords", "sos", commonKeywords.concat(commonBuiltins));

            function top(state) {
                return state.scopes[state.scopes.length - 1];
            }

            CodeMirror.defineMode("sos", function(conf, parserConf) {
                var ERRORCLASS = "error";

                var singleDelimiters = parserConf.singleDelimiters || /^[\(\)\[\]\{\}@,:`=;\.]/;
                var doubleOperators = parserConf.doubleOperators || /^([!<>]==|<>|<<|>>|\/\/|\*\*)/;
                var doubleDelimiters = parserConf.doubleDelimiters || /^(\+=|\-=|\*=|%=|\/=|&=|\|=|\^=)/;
                var tripleDelimiters = parserConf.tripleDelimiters || /^(\/\/=|>>=|<<=|\*\*=)/;

                var hangingIndent = parserConf.hangingIndent || conf.indentUnit;

                var myKeywords = commonKeywords,
                    myBuiltins = commonBuiltins;
                if (parserConf.extra_keywords != undefined)
                    myKeywords = myKeywords.concat(parserConf.extra_keywords);

                if (parserConf.extra_builtins != undefined)
                    myBuiltins = myBuiltins.concat(parserConf.extra_builtins);

                var singleOperators = parserConf.singleOperators || /^[\+\-\*\/%\$&|\^~<>!@]/;
                var identifiers = parserConf.identifiers || /^[_A-Za-z\u00A1-\uFFFF][_A-Za-z0-9\u00A1-\uFFFF]*/;
                myKeywords = myKeywords.concat(["nonlocal", "False", "True", "None", "async", "await"]);
                myBuiltins = myBuiltins.concat(["ascii", "bytes", "exec", "print"]);
                var stringPrefixes = new RegExp("^(([rbuf]|(br))?('{3}|\"{3}|['\"]))", "i");
                var keywords = wordRegexp(myKeywords);
                var builtins = wordRegexp(myBuiltins);

                // tokenizers
                function tokenBase(stream, state) {
                    if (stream.sol()) state.indent = stream.indentation()
                    // Handle scope changes
                    if (stream.sol() && top(state).type == "py") {
                        var scopeOffset = top(state).offset;
                        if (stream.eatSpace()) {
                            var lineOffset = stream.indentation();
                            if (lineOffset > scopeOffset)
                                pushPyScope(state);
                            else if (lineOffset < scopeOffset && dedent(stream, state))
                                state.errorToken = true;
                            return null;
                        } else {
                            var style = tokenBaseInner(stream, state);
                            if (scopeOffset > 0 && dedent(stream, state))
                                style += " " + ERRORCLASS;
                            return style;
                        }
                    }
                    return tokenBaseInner(stream, state);
                }

                function tokenBaseInner(stream, state) {
                    if (stream.eatSpace()) return null;

                    var ch = stream.peek();

                    // Handle Comments
                    if (ch == "#") {
                        stream.skipToEnd();
                        return "comment";
                    }
                    // BO PENG
                    // handle shell command
                    if (state.beginningOfLine && stream.match(/![a-zA-Z]+/)) {
                        stream.next();
                        return "meta";
                    }
                    // handle magic
                    if (state.beginningOfLine && stream.match(/%[a-zA-Z]+/)) {
                        stream.next();
                        return "meta";
                    }

                    if (state.beginningOfLine && stream.match(/[a-zA-Z]+:/)) {
                        stream.next();
                        return "meta";
                    }
                    // handle section header
                    if (state.beginningOfLine && stream.match(/\[.*\]\s*$/)) {
                        stream.skipToEnd();
                        return "meta";
                    }
                    // Handle Number Literals
                    if (stream.match(/^[0-9\.]/, false)) {
                        var floatLiteral = false;
                        // Floats
                        if (stream.match(/^\d*\.\d+(e[\+\-]?\d+)?/i)) {
                            floatLiteral = true;
                        }
                        if (stream.match(/^\d+\.\d*/)) {
                            floatLiteral = true;
                        }
                        if (stream.match(/^\.\d+/)) {
                            floatLiteral = true;
                        }
                        if (floatLiteral) {
                            // Float literals may be "imaginary"
                            stream.eat(/J/i);
                            return "number";
                        }
                        // Integers
                        var intLiteral = false;
                        // Hex
                        if (stream.match(/^0x[0-9a-f]+/i)) intLiteral = true;
                        // Binary
                        if (stream.match(/^0b[01]+/i)) intLiteral = true;
                        // Octal
                        if (stream.match(/^0o[0-7]+/i)) intLiteral = true;
                        // Decimal
                        if (stream.match(/^[1-9]\d*(e[\+\-]?\d+)?/)) {
                            // Decimal literals may be "imaginary"
                            stream.eat(/J/i);
                            // TODO - Can you have imaginary longs?
                            intLiteral = true;
                        }
                        // Zero by itself with no other piece of number.
                        if (stream.match(/^0(?![\dx])/i)) intLiteral = true;
                        if (intLiteral) {
                            // Integer literals may be "long"
                            stream.eat(/L/i);
                            return "number";
                        }
                    }

                    // Handle Strings
                    if (stream.match(stringPrefixes)) {
                        state.tokenize = tokenStringFactory(stream.current());
                        return state.tokenize(stream, state);
                    }

                    // Handle operators and Delimiters
                    if (stream.match(tripleDelimiters) || stream.match(doubleDelimiters))
                        return "punctuation";

                    if (stream.match(doubleOperators) || stream.match(singleOperators))
                        return "operator";

                    if (stream.match(singleDelimiters))
                        return "punctuation";

                    if (state.lastToken == "." && stream.match(identifiers))
                        return "property";

                    if (stream.match(keywords) || stream.match(wordOperators))
                        return "keyword";

                    if (stream.match(builtins))
                        return "builtin";

                    if (stream.match(/^(self|cls)\b/))
                        return "variable-2";

                    if (stream.match(identifiers)) {
                        if (state.lastToken == "def" || state.lastToken == "class")
                            return "def";
                        return "variable";
                    }

                    // Handle non-detected items
                    stream.next();
                    return ERRORCLASS;
                }

                function tokenStringFactory(delimiter) {
                    while ("rub".indexOf(delimiter.charAt(0).toLowerCase()) >= 0)
                        delimiter = delimiter.substr(1);

                    var singleline = delimiter.length == 1;
                    var OUTCLASS = "string";

                    function tokenString(stream, state) {
                        while (!stream.eol()) {
                            stream.eatWhile(/[^'"\\]/);
                            if (stream.eat("\\")) {
                                stream.next();
                                if (singleline && stream.eol())
                                    return OUTCLASS;
                            } else if (stream.match(delimiter)) {
                                state.tokenize = tokenBase;
                                return OUTCLASS;
                            } else {
                                stream.eat(/['"]/);
                            }
                        }
                        if (singleline) {
                            if (parserConf.singleLineStringErrors)
                                return ERRORCLASS;
                            else
                                state.tokenize = tokenBase;
                        }
                        return OUTCLASS;
                    }
                    tokenString.isString = true;
                    return tokenString;
                }

                function pushPyScope(state) {
                    while (top(state).type != "py") state.scopes.pop()
                    state.scopes.push({
                        offset: top(state).offset + conf.indentUnit,
                        type: "py",
                        align: null
                    })
                }

                function pushBracketScope(stream, state, type) {
                    var align = stream.match(/^([\s\[\{\(]|#.*)*$/, false) ? null : stream.column() + 1
                    state.scopes.push({
                        offset: state.indent + hangingIndent,
                        type: type,
                        align: align
                    })
                }

                function dedent(stream, state) {
                    var indented = stream.indentation();
                    while (top(state).offset > indented) {
                        if (top(state).type != "sos") return true;
                        state.scopes.pop();
                    }
                    return top(state).offset != indented;
                }

                function tokenLexer(stream, state) {
                    if (stream.sol()) state.beginningOfLine = true;

                    var style = state.tokenize(stream, state);
                    var current = stream.current();

                    // Handle decorators
                    if (state.beginningOfLine && current == "@")
                        return stream.match(identifiers, false) ? "meta" : py3 ? "operator" : ERRORCLASS;



                    if (/\S/.test(current)) state.beginningOfLine = false;

                    //if ((style == "variable" || style == "builtin")
                    //    && state.lastToken == "meta")
                    //  style = "meta";

                    // Handle scope changes.
                    if (current == "pass" || current == "return")
                        state.dedent += 1;

                    if (current == "lambda") state.lambda = true;
                    if (current == ":" && !state.lambda && top(state).type == "py")
                        pushPyScope(state);

                    var delimiter_index = current.length == 1 ? "[({".indexOf(current) : -1;
                    if (delimiter_index != -1)
                        pushBracketScope(stream, state, "])}".slice(delimiter_index, delimiter_index + 1));

                    delimiter_index = "])}".indexOf(current);
                    if (delimiter_index != -1) {
                        if (top(state).type == current) state.indent = state.scopes.pop().offset - hangingIndent
                        else return ERRORCLASS;
                    }
                    if (state.dedent > 0 && stream.eol() && top(state).type == "py") {
                        if (state.scopes.length > 1) state.scopes.pop();
                        state.dedent -= 1;
                    }

                    return style;
                }

                var external = {
                    startState: function(basecolumn) {
                        return {
                            tokenize: tokenBase,
                            scopes: [{
                                offset: basecolumn || 0,
                                type: "sos",
                                align: null
                            }],
                            indent: basecolumn || 0,
                            lastToken: null,
                            lambda: false,
                            dedent: 0
                        };
                    },

                    token: function(stream, state) {
                        var addErr = state.errorToken;
                        if (addErr) state.errorToken = false;
                        var style = tokenLexer(stream, state);

                        if (style && style != "comment")
                            state.lastToken = (style == "keyword" || style == "punctuation") ? stream.current() : style;
                        if (style == "punctuation") style = null;

                        if (stream.eol() && state.lambda)
                            state.lambda = false;
                        return addErr ? style + " " + ERRORCLASS : style;
                    },

                    indent: function(state, textAfter) {
                        if (state.tokenize != tokenBase)
                            return state.tokenize.isString ? CodeMirror.Pass : 0;

                        var scope = top(state),
                            closing = scope.type == textAfter.charAt(0)
                        if (scope.align != null)
                            return scope.align - (closing ? 1 : 0)
                        else
                            return scope.offset - (closing ? hangingIndent : 0)
                    },

                    electricInput: /^\s*[\}\]\)]$/,
                    closeBrackets: {
                        triples: "'\""
                    },
                    lineComment: "#",
                    fold: "indent"
                };
                return external;
            });

            CodeMirror.defineMIME("text/x-sos", "sos");

        });

    }

    return {
        onload: onload
    }
})
