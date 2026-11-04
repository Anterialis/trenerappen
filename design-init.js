// Setter valgt design før siden tegnes, så det ikke blinker. Valget gjøres under Innstillinger.
(function(){
  var d = 'a';
  try { d = localStorage.getItem('spillerbytte_design_v1') || 'a'; } catch(e){}
  document.documentElement.setAttribute('data-design', d);
})();
