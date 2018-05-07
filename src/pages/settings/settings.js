(function(){
	"use strict";
	
	// Document ready
	$(document).on("ready", function(){
		// Load previously stored configs
		ConfigManager.load();
		KC3Meta.init("../../data/");
		KC3Translation.execute();
		
		// Add configurable settings
		$.ajax({
			dataType: 'json',
			url: "../../data/settings.json",
			success: function(response){
				for(const sctr in response){
					// Add section header
					const sectionBox = $("#factory .section").clone().appendTo("#wrapper .settings");
					$(".title", sectionBox).text( KC3Meta.term( response[sctr].section ) );
					
					// Learn more button
					if(response[sctr].help!==""){
						$("a", sectionBox).attr("href", response[sctr].help );
					}else{
						$("a", sectionBox).hide();
					}
					
					// Add settings boxes under this section
					for(const cctr in response[sctr].contents){
						// hide "private/deprecated" settings
						if ((parseInt(response[sctr].contents[cctr].hide) || 0) === 0)
							new SettingsBox( response[sctr].contents[cctr] );
					}
				}
				$(".settings").tooltip();
			}
		});
		
	});
	
})();