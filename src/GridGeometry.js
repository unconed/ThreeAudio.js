/**
 * Plane geometry for drawing audio. UV's are corrected to ensure pixel-perfect sampling.
 */
ThreeAudio.GridGeometry = function (textures, width, depth, segmentsW, segmentsH) {
  // Reach audio source
  var source = textures.source;

  // Auto set segment counts
  segmentsW = (segmentsW || source.samples) - 1;
  segmentsH = Math.min(textures.history, segmentsH || textures.history) - 1;

  // UV correction for accurate sampling.
  var scale = segmentsH / textures.history,
      offsetU = .5 / (source.samples - 1); // Clamp to Edge wrapping
      offsetV = .5 / textures.history;     // Repeat wrapping

  // Need one less H segment due to history not looping.
  var geometry = new THREE.PlaneGeometry(width, depth, segmentsW, segmentsH);
  _.each(geometry.faceVertexUvs[0], function (face) {
    _.each(face, function (uv) {
      uv.u += offsetU;
      uv.v = 1 - uv.v * scale + offsetV;
    });
  });

  return geometry;
};
