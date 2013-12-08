// Check dependencies.
(function (deps) {
  for (var i in deps) {
    if (!window[i]) throw "Error: ThreeAudio requires " + deps[i];
  }
})({
  'THREE': 'Three.js',
  'MicroEvent': 'MicroEvent.js',
});

// Namespace
window.ThreeAudio = window.ThreeAudio || {};

// Fetch shader from <script> tag by id
// or pass through string if not exists.
ThreeAudio.getShader = function (id) {
  var elem = document.getElementById(id);
  return elem && (elem.innerText || elem.textContent) || id;
};

// Simple array/object iterator.
// (can be replaced with underscore.js)
window._ = window._ || {};
_.each = _.each || function (object, callback) {
  if (object.forEach) {
    return object.forEach(callback);
  }
  for (key in object) {
    callback(object[key], key, object);
  }
};

// Simple object extender
// (can be replaced with underscore.js)
_.extend = _.extend || function (destination) {
  _.each([].slice.call(arguments, 1), function (source) {
    for (var key in source) {
      destination[key] = source[key];
    }
  });
  return destination;
}

// Make microevent methods chainable.
MicroEvent.prototype.on   = function () { MicroEvent.prototype.bind.apply(this, arguments);    return this; }
MicroEvent.prototype.emit = function () { MicroEvent.prototype.trigger.apply(this, arguments); return this; }
MicroEvent.mixin	= function(destObject){
	var props	= ['bind', 'unbind', 'trigger', 'on', 'emit'];
	for(var i = 0; i < props.length; i ++){
		destObject.prototype[props[i]]	= MicroEvent.prototype[props[i]];
	}
}

// Compatibility with ThreeRTT/ThreeBox
ThreeAudio.toTexture = function (texture) {
  return (ThreeRTT && ThreeRTT.toTexture && ThreeRTT.toTexture(texture)) || texture;
}

// Math!
var π = Math.PI,
    τ = π * 2;
