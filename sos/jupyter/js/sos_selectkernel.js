function changeStyleOnKernel(cell, type) {
            if (BackgroundColor[type]) {
                cell.element[0].getElementsByClassName('input_prompt')[0].style.backgroundColor = BackgroundColor[type];
                cell.element[0].getElementsByClassName('out_prompt_overlay')[0].style.backgroundColor = BackgroundColor[type];
            } else {
                // Use '' to remove background-color?
                cell.element[0].getElementsByClassName('input_prompt')[0].style.backgroundColor = '';
                cell.element[0].getElementsByClassName('out_prompt_overlay')[0].style.backgroundColor = '';
            }

            var sel = cell.element[0].getElementsByTagName('select')[0]
            var opts = sel.options;
            for (var opt, j = 0; opt = opts[j]; j++) {
                if (opt.value == DisplayName[type]) {
                    sel.selectedIndex = j;
                    break;
                }
            }
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
                css.innerHTML = '.code_cell .celltoolbar {width:10%;background:none;border:none;border-bottom:none;z-index: 1000;position:relative;margin-bottom:-50pt;float:right;}  .text_cell .celltoolbar {display:none}';
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
                    //}
                    // cell.metadata.kernel = KernelName[value];
                    if (BackgroundColor[value]) {
                        cell.element[0].getElementsByClassName('input_prompt')[0].style.backgroundColor = BackgroundColor[value];
                        cell.element[0].getElementsByClassName('out_prompt_overlay')[0].style.backgroundColor = BackgroundColor[value];
                    } else {
                        // Use '' to remove background-color?
                        cell.element[0].getElementsByClassName('input_prompt')[0].style.backgroundColor = '';
                        cell.element[0].getElementsByClassName('out_prompt_overlay')[0].style.backgroundColor = '';
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

function changeCellStyle(){
    var cells = IPython.notebook.get_cells();
    // setting up background color and selection according to notebook metadata
    for (var i in cells) {
        if (cells[i].cell_type == 'code') {
            changeStyleOnKernel(cells[i], cells[i].metadata.kernel);
        }
    }
}