/*
 * JS for the molybdenum app.
 *
 * Presumes that jquery has already been loaded.
 */

var DEBUG = false;

var Molybdenum = (function() {

  var linesRe = /^#L(\d+)(-(\d+))?$/;

  return {
    ping: function ping() {
      alert('pong');
    },

    highlightCodeLines: function highlightCodeLines(hash) {
      $(".line[highlight=true]").css("background-color", "transparent");
      var m = linesRe.exec(document.location.hash);
      if (m) {
        var start = Number(m[1]), end = m[3];
        if (end !== undefined) {
          end = Number(end);
          for (var i=start; i<=end; i++) {
            $("#LC"+i).css("background-color", "#eee8d5").attr("highlight", "true");
          }
        } else {
          $("#LC"+start).css("background-color", "#eee8d5").attr("highlight", "true");
        }
        $(document).scrollTop($("#LC"+start).position().top + 30);
      }
    },

    onCodeLineNumMouseDown: function onCodeLineNumMouseDown(event) {
      var rel = event.target.getAttribute("rel");
      DEBUG && console.log("onCodeLineNumMouseDown: rel:", rel);
      var m = linesRe.exec(document.location.hash);
      DEBUG && console.log("onCodeLineNumMouseDown: m:", m, " shiftKey:", event.shiftKey);
      if (event.shiftKey && m) {
        var start = Number(m[1]);
        var end = Number(event.target.textContent);
        if (end < start) {
          var tmp = end;
          end = start;
          start = tmp;
        }
        DEBUG && console.log("onCodeLineNumMouseDown: start=%s, end=%s", start, end);
        if (start === end) {
          document.location.hash = "L"+start;
        } else {
          document.location.hash = "L"+start+"-"+end;
        }
        event.preventDefault();
      } else {
        document.location.hash = rel;
      }
      Molybdenum.highlightCodeLines();
    }

  };
})();
