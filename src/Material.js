/**
 * Helper for making ShaderMaterials that read from the audio buffers.
 */
ThreeAudio.Material = function (audioTextures, vertexShader, fragmentShader, textures, uniforms, attributes) {
  attributes = attributes || [];

  // Uniform for time scrolling
  uniforms = _.extend(uniforms || {}, {
    audioIsBeat: {
      type: 'f',
      value: 0,
    },
    audioWasBeat: {
      type: 'f',
      value: 0,
    },
    audioLevels: {
      type: 'fv1',
      value: [0,0,0,0],
    },
    audioLevelsSmooth: {
      type: 'fv1',
      value: [0,0,0,0],
    },
    audioLevelsChange: {
      type: 'fv1',
      value: [0,0,0,0],
    },
    audioOffset: {
      type: 'f',
      value: 0,
    },
    audioStep: {
      type: 'v2',
      value: { x: 0, y: 0 },
    },
  });

  // Generate uniforms for freq/time textures
  var i = 0;
  _.each(audioTextures.get(), function (texture, key) {

    // Make wrapper texture object.
    var textureObject = new THREE.Texture(
      new Image(),
      new THREE.UVMapping(),
      THREE.ClampToEdgeWrapping,
      THREE.RepeatWrapping,
      THREE.NearestFilter,
      THREE.NearestFilter
    );

    // Pre-init texture to trick WebGLRenderer
    textureObject.__webglInit = true;
    textureObject.__webglTexture = texture;

    uniforms[key + 'Data'] = {
      type: 't',
      value: textureObject,
    };
  });

  // Make uniforms for input textures.
  _.each(textures || [], function (texture, key) {
    uniforms[key] = {
      type: 't',
      value: ThreeAudio.toTexture(texture),
    };
  });

  // Auto-update uniforms when textures are updated.
  audioTextures.on('update', function (_uniforms) {
    // Apply uniform values from texture object.
    _.each(_uniforms, function (value, key) {
      uniforms[key].value = value;
    });
  });

  // Lookup shaders and build material
  return new THREE.ShaderMaterial({
    attributes:     attributes,
    uniforms:       uniforms,
    vertexShader:   ThreeAudio.getShader(vertexShader),
    fragmentShader: ThreeAudio.getShader(fragmentShader),
  });
};
