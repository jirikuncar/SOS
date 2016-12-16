$(document).ready(function(){
	$("#intro_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Overview.html"); 
	$("#installation_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Running_SoS.html"); 
	$("#documentation_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Documentation.html"); 
	$("#features_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Features.html"); 
/*	$("#intro_content").load("doc/homepage/Overview.html"); 
	$("#installation_content").load("doc/homepage/Running_SoS.html"); 
	$("#documentation_content").load("doc/homepage/Documentation.html"); 
	$("#features_content").load("doc/homepage/Features.html"); */



	
	// var tuts=tutorials
	// $("#tutorial > .container").append('<div class="row">')
	// for (var a =0;a<tuts.length;a++){
	// 	var name =tuts[a];
	// 	var oneString='<div class="col-md-4 col-sm-6 portfolio-item">'
 //        				+'<div class="portfolio-caption">';
	// 	oneString+='<a href="./doc/tutorials/'+name+'.html" class="portfolio-link"><h4>'+name+'</h4></a>';
	// 	oneString+='</div></div>';       	
	// 	 $("#tutorial > .container").append(
	//        	oneString
	//      );
	// }	
	// $("#tutorial > .container").append('</div>');	


 // 	var docs=documentation
	// $("#documentation > .container").append('<div class="row">')
	// for (var a =0;a<docs.length;a++){
	// 	var name =docs[a];
	// 	var oneString='<div class="col-md-4 col-sm-6 portfolio-item">'
 //        				+'<div class="portfolio-caption">';
	// 	oneString+='<a href="./doc/documentation/'+name+'.html" class="portfolio-link"><h4>'+name+'</h4></a>';
	// 	oneString+='</div></div>';       	
	// 	 $("#documentation > .container").append(
	//        	oneString
	//      );
	// }	
	// $("#documentation > .container").append('</div>');		



	 $(window).on('scroll',function() {
            var scrolltop = $(this).scrollTop();
         
            if(scrolltop >= 900) {
              $('#fixedbar').fadeIn(250);
            }
            
            else if(scrolltop <= 900) {
              $('#fixedbar').fadeOut(250);
            }
          });

	// var tabindex=$("#fixedbar").tabs({active:1}).tabs("option","active");
	// console.log(tabindex);
	// $("#navigation").tabs().tabs("option","active",tabindex);

	  $("#fixedbar li a ").click(function(){
	  		var tabindex=$(this).attr('href');
	  		$('#navigation li a').filter('[href="'+tabindex+'"]').tab('show'); 		
	  })
        
      $("#navigation li a ").click(function(){
	  		var tabindex=$(this).attr('href');
	  		$('#fixedbar li a').filter('[href="'+tabindex+'"]').tab('show'); 		
	  })

	var imgs=images

      $('header').css({'background-image': 'url(img/' + imgs[Math.floor(Math.random() * imgs.length)] + ')'});
	
});
