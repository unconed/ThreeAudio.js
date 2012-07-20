/**
 * Create an audio source.
 */
tQuery.World.register('audio', function (fftSize) {
  return tQuery.createAudioSource(this, fftSize);
});

/**
 * Create an audio source.
 */
tQuery.register('createAudioSource', function (world, fftSize) {
  // Create source
  var source = new ThreeAudio.Source(fftSize);

  // Add .textures() method.
  source.textures = function (history) {
    return tQuery.createAudioTextures(world, this, history);
  };

  return source;
});

/**
 * Create a set of audio textures for sound data.
 */
tQuery.register('createAudioTextures', function (world, source, history) {
  var audioTextures = new ThreeAudio.Textures(world.tRenderer(), source, history);

  // Add .material() method.
  audioTextures.material = function (vertexShader, fragmentShader, textures,
                                uniforms, attributes) {
    return tQuery.createAudioMaterial(this, vertexShader, fragmentShader, textures,
                                     uniforms, attributes);
  };

  // Auto-update textures before render.
  world.loop().hookPreRender(function () {
    audioTextures.update();
  });

  return audioTextures;
});

/**
 * Create an audio material for shading sound data.
 */
tQuery.register('createAudioMaterial',
  function (audioTextures, vertexShader, fragmentShader, textures, uniforms, attributes) {
    var material = new ThreeAudio.Material(
      audioTextures,
      vertexShader,
      fragmentShader,
      textures,
      uniforms,
      attributes//,
    );

    // Add .grid() method.
    material.grid = function (width, height, segmentsW, segmentsH) {
      return tQuery.createAudioGrid(audioTextures, width, height, segmentsW, segmentsH, this);
    };

    return material;
  }
);

/**
 * Create an audio grid for rendering sound data with.
 */
tQuery.register('createAudioGrid', function (textures, width, depth, segmentsW, segmentsH, material) {
  var defaults  = [textures, 1, 1, 0, 0];
  for (i in defaults) {
    arguments[i] = arguments[i] || defaults[i];
  }

  var geometry = new ThreeAudio.GridGeometry(
    textures,
    width || 1,
    depth || 1,
    segmentsW,
    segmentsH
  );

  var material = material || tQuery.defaultObject3DMaterial;

  var mesh = new THREE.Mesh(geometry, material);
  mesh.doubleSided = true;
  mesh.frustumCulled = false;

  return tQuery(mesh);
});
