// generated by ../build.js
var View = require("rincewind")
module.exports = {
  window: View({"c": ["  <!doctype  html> <html> <head> <title>Loop Drop</title> <link rel=\"stylesheet\" href=\"bundle.css\"/> <link rel=\"stylesheet\" href=\"extra.css\"/> </head> <body data-behavior=\"engine project\"> <div class=\"Metro\" data-behavior=\"metro\"></div> <div class=\"Holder\"> <div class=\"Deck -left\" data-id=\"left\" data-behavior=\"deck.selected\">",{"v":"deck"},"</div> <div class=\"Editor\">",{"v":"editor"},"</div> <div class=\"Deck -right\" data-id=\"right\" data-behavior=\"deck.selected\">",{"v":"deck"},"</div> </div> <script src=\"bundle.js\"></script> </body> </html>"], "views": {"deck": {"c": [" <div class=\"Loader\"> <div class=\".kits\" data-behavior=\"deck.kits\"></div> </div> <div class=\"KitControl\" data-behavior=\"deck.control\"> <a class=\".sample\" href=\"#\">Start Sampling</a> <a class=\".stopSampling\" href=\"#\">Stop Sampling</a> </div> <div class=\"Kit\" data-behavior=\"slot.selector\">",{"v":"kit"},"</div>"], "views": {"kit": require("./kit.js")}},"editor": {"c": ["<div class=\"RawEditor\" data-behavior=\"editor.raw\"></div>"], "views": {}}}})
}