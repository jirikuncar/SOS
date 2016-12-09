$(document).ready(function(){
	$("#intro_content").load("https://github.com/BoPeng/SOS/blob/master/docs/doc/README.html"); 
	
	var tuts=tutorials
	$("#tutorial > .container").append('<div class="row">')
	for (var a =0;a<tuts.length;a++){
		var name =tuts[a];
		var oneString='<div class="col-md-4 col-sm-6 portfolio-item">'
        				+'<div class="portfolio-caption">';
		oneString+='<a href="./doc/tutorials/'+name+'.html" class="portfolio-link"><h4>'+name+'</h4></a>';
		oneString+='</div></div>';       	
		 $("#tutorial > .container").append(
	       	oneString
	     );
	}	
	$("#tutorial > .container").append('</div>');	


 	var docs=documentation
	$("#documentation > .container").append('<div class="row">')
	for (var a =0;a<docs.length;a++){
		var name =docs[a];
		var oneString='<div class="col-md-4 col-sm-6 portfolio-item">'
        				+'<div class="portfolio-caption">';
		oneString+='<a href="./doc/documentation/'+name+'.html" class="portfolio-link"><h4>'+name+'</h4></a>';
		oneString+='</div></div>';       	
		 $("#documentation > .container").append(
	       	oneString
	     );
	}	
	$("#documentation > .container").append('</div>');		








	// var dir = "../../doc/documentation_html/";
	// var fileextension = ".html";
	// $("#documentation > .container").append('<div class="row">')
	// $.ajax({
	//     //This will retrieve the contents of the folder if the folder is configured as 'browsable'
	//     url: dir,
	//     success: function (data) {
	//         //List all .png file names in the page
	//         $(data).find("a:contains(" + fileextension + ")").each(function () {
	
	//         	var cons=this.href.split("/");
	//         	var name=cons.slice(1).slice(-2);
	//         	var path="./"+name[0]+"/"+name[1];
	//             var oneString='<div class="col-md-4 col-sm-6 portfolio-item">'
 //        				+'<div class="portfolio-caption">';
 //        		oneString+="<a href="+path+">"+name[1].replace("html","")+"</a>";
 //        		oneString+='</div></div>';       	
 //        		 $("#documentation > .container").append(
	// 		       	oneString
	// 		     );
	  
	//         });
	//     }
	// });
	// $("#documentation > .container").append('</div>');

	// var dir = "../../doc/tutorial_html/";
	// var fileextension = ".html";
	// $("#tutorial > .container").append('<div class="row">')
	// $.ajax({
	//     //This will retrieve the contents of the folder if the folder is configured as 'browsable'
	//     url: dir,
	//     success: function (data) {
	//         //List all .png file names in the page
	//         $(data).find("a:contains(" + fileextension + ")").each(function () {
	
	//         	var cons=this.href.split("/");
	//         	var name=cons.slice(1).slice(-2);
	//         	var path="./"+name[0]+"/"+name[1];
	//             var oneString='<div class="col-md-4 col-sm-6 portfolio-item">'
 //        				+'<div class="portfolio-caption">';
 //        		oneString+="<a href="+path+">"+name[1].replace("html","")+"</a>";
 //        		oneString+='</div></div>';       	
 //        		 $("#tutorial > .container").append(
	// 		       	oneString
	// 		     );
	  
	//         });
	//     }
	// });
	// $("#tutorial > .container").append('</div>');
	
});
