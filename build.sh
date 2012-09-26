#!/bin/bash
VENDOR="
vendor/microevent.js
vendor/dsp.js
"

SRC="
src/Common.js
src/Source.js
src/Material.js
src/Textures.js
src/GridGeometry.js
src/LevelDetect.js
src/BeatDetect.js
"

TQUERY="
src/tQuery.js
"

SHADERS="
shaders/shaders.glsl.html
"

cat $VENDOR $SRC > build/ThreeAudio.js
cat $VENDOR $SRC $TQUERY > build/ThreeAudio-tquery.js
cat $SHADERS > build/shaders.glsl.html

curl --data-urlencode "js_code@build/ThreeAudio.js" 	\
	-d "output_format=text&output_info=compiled_code&compilation_level=SIMPLE_OPTIMIZATIONS" \
	http://closure-compiler.appspot.com/compile	\
	> build/ThreeAudio.min.js

curl --data-urlencode "js_code@build/ThreeAudio-tquery.js" 	\
	-d "output_format=text&output_info=compiled_code&compilation_level=SIMPLE_OPTIMIZATIONS" \
	http://closure-compiler.appspot.com/compile	\
	> build/ThreeAudio-tquery.min.js
