$(document).ready(function(){
	$("#intro_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Overview.html"); 
	$("#installation_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Running_SoS.html"); 
	$("#documentation_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Documentation.html"); 
	$("#features_content").load("https://raw.githubusercontent.com/BoPeng/SOS/master/docs/doc/homepage/Features.html"); 
/*	$("#intro_content").load("doc/homepage/Overview.html"); 
	$("#installation_content").load("doc/homepage/Running_SoS.html"); 
	$("#documentation_content").load("doc/homepage/Documentation.html"); 
	$("#features_content").load("doc/homepage/Features.html"); */


	 $(window).on('scroll',function() {
            var scrolltop = $(this).scrollTop();
         
            if(scrolltop >= 300) {
              $('#fixedbar').fadeIn(250);
            }
            
            else if(scrolltop <= 300) {
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

      // Get random images
	  var imgs=images
      // $('header').css({'background-image': 'url(img/' + imgs[Math.floor(Math.random() * imgs.length)] + ')','height':'600px'});
      $('header').css({'background-image': 'url(img/' + imgs[Math.floor(Math.random() * imgs.length)] + ')'});

      $('.nav a').click(function (e) {
		  e.preventDefault()
		  $(this).tab('show')
		})  
    
	  $('a.scroll').on('click', function (e) {
	        var href = $(this).attr('href');
	        $('html, body').animate({
	            scrollTop: $(href).offset().top-50
	        }, 'slow');
	        e.preventDefault();
	   });

	  function activateTab(tab){
    		$('.nav-tabs a[href="#' + tab + '"]').tab('show');
	  };

	  var hash = document.location.hash;	
	  if (hash=="#documentation") {
	  		activateTab(4);
	  		$('html, body').stop().animate({
            	scrollTop: ($("#exTab2").offset().top - 50)
         	}, 'fast');
	  } 

	  $('.nav-tabs a').on('shown.bs.tab', function (e) {
    		window.location.hash = "#exTab2";
		});



	
});
