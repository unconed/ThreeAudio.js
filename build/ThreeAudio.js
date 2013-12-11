/**
 * MicroEvent - to make any js object an event emitter (server or browser)
 * 
 * - pure javascript - server compatible, browser compatible
 * - dont rely on the browser doms
 * - super simple - you get it immediatly, no mistery, no magic involved
 *
 * - create a MicroEventDebug with goodies to debug
 *   - make it safer to use
*/

var MicroEvent	= function(){}
MicroEvent.prototype	= {
	bind	: function(event, fct){
		this._events = this._events || {};
		this._events[event] = this._events[event]	|| [];
		this._events[event].push(fct);
	},
	unbind	: function(event, fct){
		this._events = this._events || {};
		if( event in this._events === false  )	return;
		this._events[event].splice(this._events[event].indexOf(fct), 1);
	},
	trigger	: function(event /* , args... */){
		this._events = this._events || {};
		if( event in this._events === false  )	return;
		for(var i = 0; i < this._events[event].length; i++){
			this._events[event][i].apply(this, Array.prototype.slice.call(arguments, 1))
		}
	}
};

/**
 * mixin will delegate all MicroEvent.js function in the destination object
 *
 * - require('MicroEvent').mixin(Foobar) will make Foobar able to use MicroEvent
 *
 * @param {Object} the object which will support MicroEvent
*/
MicroEvent.mixin	= function(destObject){
	var props	= ['bind', 'unbind', 'trigger'];
	for(var i = 0; i < props.length; i ++){
		destObject.prototype[props[i]]	= MicroEvent.prototype[props[i]];
	}
}

// export in common js
if( typeof module !== "undefined" && ('exports' in module)){
	module.exports	= MicroEvent
}/* 
 *  DSP.js - a comprehensive digital signal processing  library for javascript
 * 
 *  Created by Corban Brook <corbanbrook@gmail.com> on 2010-01-01.
 *  Copyright 2010 Corban Brook. All rights reserved.
 *
 */

////////////////////////////////////////////////////////////////////////////////
//                                  CONSTANTS                                 //
////////////////////////////////////////////////////////////////////////////////

/**
 * DSP is an object which contains general purpose utility functions and constants
 */
var DSP = {
  // Channels
  LEFT:           0,
  RIGHT:          1,
  MIX:            2,

  // Waveforms
  SINE:           1,
  TRIANGLE:       2,
  SAW:            3,
  SQUARE:         4,

  // Filters
  LOWPASS:        0,
  HIGHPASS:       1,
  BANDPASS:       2,
  NOTCH:          3,

  // Window functions
  BARTLETT:       1,
  BARTLETTHANN:   2,
  BLACKMAN:       3,
  COSINE:         4,
  GAUSS:          5,
  HAMMING:        6,
  HANN:           7,
  LANCZOS:        8,
  RECTANGULAR:    9,
  TRIANGULAR:     10,

  // Loop modes
  OFF:            0,
  FW:             1,
  BW:             2,
  FWBW:           3,

  // Math
  TWO_PI:         2*Math.PI
};

// Fourier Transform Module used by DFT, FFT, RFFT
function FourierTransform(bufferSize, sampleRate) {
  this.bufferSize = bufferSize;
  this.sampleRate = sampleRate;
  this.bandwidth  = 2 / bufferSize * sampleRate / 2;

  this.spectrum   = new Float32Array(bufferSize/2);
  this.real       = new Float32Array(bufferSize);
  this.imag       = new Float32Array(bufferSize);

  this.peakBand   = 0;
  this.peak       = 0;

  /**
   * Calculates the *middle* frequency of an FFT band.
   *
   * @param {Number} index The index of the FFT band.
   *
   * @returns The middle frequency in Hz.
   */
  this.getBandFrequency = function(index) {
    return this.bandwidth * index + this.bandwidth / 2;
  };

  this.calculateSpectrum = function() {
    var spectrum  = this.spectrum,
        real      = this.real,
        imag      = this.imag,
        bSi       = 2 / this.bufferSize,
        sqrt      = Math.sqrt,
        rval, 
        ival,
        mag;

    for (var i = 0, N = bufferSize/2; i < N; i++) {
      rval = real[i];
      ival = imag[i];
      mag = bSi * sqrt(rval * rval + ival * ival);

      if (mag > this.peak) {
        this.peakBand = i;
        this.peak = mag;
      }

      spectrum[i] = mag;
    }
  };
}

/**
 * DFT is a class for calculating the Discrete Fourier Transform of a signal.
 *
 * @param {Number} bufferSize The size of the sample buffer to be computed
 * @param {Number} sampleRate The sampleRate of the buffer (eg. 44100)
 *
 * @constructor
 */
function DFT(bufferSize, sampleRate) {
  FourierTransform.call(this, bufferSize, sampleRate);

  var N = bufferSize/2 * bufferSize;
  var TWO_PI = 2 * Math.PI;

  this.sinTable = new Float32Array(N);
  this.cosTable = new Float32Array(N);

  for (var i = 0; i < N; i++) {
    this.sinTable[i] = Math.sin(i * TWO_PI / bufferSize);
    this.cosTable[i] = Math.cos(i * TWO_PI / bufferSize);
  }
}

/**
 * Performs a forward transform on the sample buffer.
 * Converts a time domain signal to frequency domain spectra.
 *
 * @param {Array} buffer The sample buffer
 *
 * @returns The frequency spectrum array
 */
DFT.prototype.forward = function(buffer) {
  var real = this.real, 
      imag = this.imag,
      rval,
      ival;

  for (var k = 0; k < this.bufferSize/2; k++) {
    rval = 0.0;
    ival = 0.0;

    for (var n = 0; n < buffer.length; n++) {
      rval += this.cosTable[k*n] * buffer[n];
      ival += this.sinTable[k*n] * buffer[n];
    }

    real[k] = rval;
    imag[k] = ival;
  }

  return this.calculateSpectrum();
};


/**
 * FFT is a class for calculating the Discrete Fourier Transform of a signal
 * with the Fast Fourier Transform algorithm.
 *
 * @param {Number} bufferSize The size of the sample buffer to be computed. Must be power of 2
 * @param {Number} sampleRate The sampleRate of the buffer (eg. 44100)
 *
 * @constructor
 */
function FFT(bufferSize, sampleRate) {
  FourierTransform.call(this, bufferSize, sampleRate);
   
  this.reverseTable = new Uint32Array(bufferSize);

  var limit = 1;
  var bit = bufferSize >> 1;

  var i;

  while (limit < bufferSize) {
    for (i = 0; i < limit; i++) {
      this.reverseTable[i + limit] = this.reverseTable[i] + bit;
    }

    limit = limit << 1;
    bit = bit >> 1;
  }

  this.sinTable = new Float32Array(bufferSize);
  this.cosTable = new Float32Array(bufferSize);

  for (i = 0; i < bufferSize; i++) {
    this.sinTable[i] = Math.sin(-Math.PI/i);
    this.cosTable[i] = Math.cos(-Math.PI/i);
  }
}

/**
 * Performs a forward transform on the sample buffer.
 * Converts a time domain signal to frequency domain spectra.
 *
 * @param {Array} buffer The sample buffer. Buffer Length must be power of 2
 *
 * @returns The frequency spectrum array
 */
FFT.prototype.forward = function(buffer) {
  // Locally scope variables for speed up
  var bufferSize      = this.bufferSize,
      cosTable        = this.cosTable,
      sinTable        = this.sinTable,
      reverseTable    = this.reverseTable,
      real            = this.real,
      imag            = this.imag,
      spectrum        = this.spectrum;

  var k = Math.floor(Math.log(bufferSize) / Math.LN2);

  if (Math.pow(2, k) !== bufferSize) { throw "Invalid buffer size, must be a power of 2."; }
  if (bufferSize !== buffer.length)  { throw "Supplied buffer is not the same size as defined FFT. FFT Size: " + bufferSize + " Buffer Size: " + buffer.length; }

  var halfSize = 1,
      phaseShiftStepReal,
      phaseShiftStepImag,
      currentPhaseShiftReal,
      currentPhaseShiftImag,
      off,
      tr,
      ti,
      tmpReal,
      i;

  for (i = 0; i < bufferSize; i++) {
    real[i] = buffer[reverseTable[i]];
    imag[i] = 0;
  }

  while (halfSize < bufferSize) {
    //phaseShiftStepReal = Math.cos(-Math.PI/halfSize);
    //phaseShiftStepImag = Math.sin(-Math.PI/halfSize);
    phaseShiftStepReal = cosTable[halfSize];
    phaseShiftStepImag = sinTable[halfSize];
    
    currentPhaseShiftReal = 1;
    currentPhaseShiftImag = 0;

    for (var fftStep = 0; fftStep < halfSize; fftStep++) {
      i = fftStep;

      while (i < bufferSize) {
        off = i + halfSize;
        tr = (currentPhaseShiftReal * real[off]) - (currentPhaseShiftImag * imag[off]);
        ti = (currentPhaseShiftReal * imag[off]) + (currentPhaseShiftImag * real[off]);

        real[off] = real[i] - tr;
        imag[off] = imag[i] - ti;
        real[i] += tr;
        imag[i] += ti;

        i += halfSize << 1;
      }

      tmpReal = currentPhaseShiftReal;
      currentPhaseShiftReal = (tmpReal * phaseShiftStepReal) - (currentPhaseShiftImag * phaseShiftStepImag);
      currentPhaseShiftImag = (tmpReal * phaseShiftStepImag) + (currentPhaseShiftImag * phaseShiftStepReal);
    }

    halfSize = halfSize << 1;
  }

  return this.calculateSpectrum();
};

FFT.prototype.inverse = function(real, imag) {
  // Locally scope variables for speed up
  var bufferSize      = this.bufferSize,
      cosTable        = this.cosTable,
      sinTable        = this.sinTable,
      reverseTable    = this.reverseTable,
      spectrum        = this.spectrum;
     
      real = real || this.real;
      imag = imag || this.imag;

  var halfSize = 1,
      phaseShiftStepReal,
      phaseShiftStepImag,
      currentPhaseShiftReal,
      currentPhaseShiftImag,
      off,
      tr,
      ti,
      tmpReal,
      i;

  for (i = 0; i < bufferSize; i++) {
    imag[i] *= -1;
  }

  var revReal = new Float32Array(bufferSize);
  var revImag = new Float32Array(bufferSize);
 
  for (i = 0; i < real.length; i++) {
    revReal[i] = real[reverseTable[i]];
    revImag[i] = imag[reverseTable[i]];
  }
 
  real = revReal;
  imag = revImag;

  while (halfSize < bufferSize) {
    phaseShiftStepReal = cosTable[halfSize];
    phaseShiftStepImag = sinTable[halfSize];
    currentPhaseShiftReal = 1;
    currentPhaseShiftImag = 0;

    for (var fftStep = 0; fftStep < halfSize; fftStep++) {
      i = fftStep;

      while (i < bufferSize) {
        off = i + halfSize;
        tr = (currentPhaseShiftReal * real[off]) - (currentPhaseShiftImag * imag[off]);
        ti = (currentPhaseShiftReal * imag[off]) + (currentPhaseShiftImag * real[off]);

        real[off] = real[i] - tr;
        imag[off] = imag[i] - ti;
        real[i] += tr;
        imag[i] += ti;

        i += halfSize << 1;
      }

      tmpReal = currentPhaseShiftReal;
      currentPhaseShiftReal = (tmpReal * phaseShiftStepReal) - (currentPhaseShiftImag * phaseShiftStepImag);
      currentPhaseShiftImag = (tmpReal * phaseShiftStepImag) + (currentPhaseShiftImag * phaseShiftStepReal);
    }

    halfSize = halfSize << 1;
  }

  var buffer = new Float32Array(bufferSize); // this should be reused instead
  for (i = 0; i < bufferSize; i++) {
    buffer[i] = real[i] / bufferSize;
  }

  return buffer;
};

/**
 * RFFT is a class for calculating the Discrete Fourier Transform of a signal
 * with the Fast Fourier Transform algorithm.
 *
 * This method currently only contains a forward transform but is highly optimized.
 *
 * @param {Number} bufferSize The size of the sample buffer to be computed. Must be power of 2
 * @param {Number} sampleRate The sampleRate of the buffer (eg. 44100)
 *
 * @constructor
 */

// lookup tables don't really gain us any speed, but they do increase
// cache footprint, so don't use them in here

// also we don't use sepearate arrays for real/imaginary parts

// this one a little more than twice as fast as the one in FFT
// however I only did the forward transform

// the rest of this was translated from C, see http://www.jjj.de/fxt/
// this is the real split radix FFT

function RFFT(bufferSize, sampleRate) {
  FourierTransform.call(this, bufferSize, sampleRate);

  this.trans = new Float32Array(bufferSize);

  this.reverseTable = new Uint32Array(bufferSize);

  // don't use a lookup table to do the permute, use this instead
  this.reverseBinPermute = function (dest, source) {
    var bufferSize  = this.bufferSize, 
        halfSize    = bufferSize >>> 1, 
        nm1         = bufferSize - 1, 
        i = 1, r = 0, h;

    dest[0] = source[0];

    do {
      r += halfSize;
      dest[i] = source[r];
      dest[r] = source[i];
      
      i++;

      h = halfSize << 1;
      while (h = h >> 1, !((r ^= h) & h));

      if (r >= i) { 
        dest[i]     = source[r]; 
        dest[r]     = source[i];

        dest[nm1-i] = source[nm1-r]; 
        dest[nm1-r] = source[nm1-i];
      }
      i++;
    } while (i < halfSize);
    dest[nm1] = source[nm1];
  };

  this.generateReverseTable = function () {
    var bufferSize  = this.bufferSize, 
        halfSize    = bufferSize >>> 1, 
        nm1         = bufferSize - 1, 
        i = 1, r = 0, h;

    this.reverseTable[0] = 0;

    do {
      r += halfSize;
      
      this.reverseTable[i] = r;
      this.reverseTable[r] = i;

      i++;

      h = halfSize << 1;
      while (h = h >> 1, !((r ^= h) & h));

      if (r >= i) { 
        this.reverseTable[i] = r;
        this.reverseTable[r] = i;

        this.reverseTable[nm1-i] = nm1-r;
        this.reverseTable[nm1-r] = nm1-i;
      }
      i++;
    } while (i < halfSize);

    this.reverseTable[nm1] = nm1;
  };

  this.generateReverseTable();
}


// Ordering of output:
//
// trans[0]     = re[0] (==zero frequency, purely real)
// trans[1]     = re[1]
//             ...
// trans[n/2-1] = re[n/2-1]
// trans[n/2]   = re[n/2]    (==nyquist frequency, purely real)
//
// trans[n/2+1] = im[n/2-1]
// trans[n/2+2] = im[n/2-2]
//             ...
// trans[n-1]   = im[1] 

RFFT.prototype.forward = function(buffer) {
  var n         = this.bufferSize, 
      spectrum  = this.spectrum,
      x         = this.trans, 
      TWO_PI    = 2*Math.PI,
      sqrt      = Math.sqrt,
      i         = n >>> 1,
      bSi       = 2 / n,
      n2, n4, n8, nn, 
      t1, t2, t3, t4, 
      i1, i2, i3, i4, i5, i6, i7, i8, 
      st1, cc1, ss1, cc3, ss3,
      e, 
      a,
      rval, ival, mag; 

  this.reverseBinPermute(x, buffer);

  /*
  var reverseTable = this.reverseTable;

  for (var k = 0, len = reverseTable.length; k < len; k++) {
    x[k] = buffer[reverseTable[k]];
  }
  */

  for (var ix = 0, id = 4; ix < n; id *= 4) {
    for (var i0 = ix; i0 < n; i0 += id) {
      //sumdiff(x[i0], x[i0+1]); // {a, b}  <--| {a+b, a-b}
      st1 = x[i0] - x[i0+1];
      x[i0] += x[i0+1];
      x[i0+1] = st1;
    } 
    ix = 2*(id-1);
  }

  n2 = 2;
  nn = n >>> 1;

  while((nn = nn >>> 1)) {
    ix = 0;
    n2 = n2 << 1;
    id = n2 << 1;
    n4 = n2 >>> 2;
    n8 = n2 >>> 3;
    do {
      if(n4 !== 1) {
        for(i0 = ix; i0 < n; i0 += id) {
          i1 = i0;
          i2 = i1 + n4;
          i3 = i2 + n4;
          i4 = i3 + n4;
     
          //diffsum3_r(x[i3], x[i4], t1); // {a, b, s} <--| {a, b-a, a+b}
          t1 = x[i3] + x[i4];
          x[i4] -= x[i3];
          //sumdiff3(x[i1], t1, x[i3]);   // {a, b, d} <--| {a+b, b, a-b}
          x[i3] = x[i1] - t1; 
          x[i1] += t1;
     
          i1 += n8;
          i2 += n8;
          i3 += n8;
          i4 += n8;
         
          //sumdiff(x[i3], x[i4], t1, t2); // {s, d}  <--| {a+b, a-b}
          t1 = x[i3] + x[i4];
          t2 = x[i3] - x[i4];
         
          t1 = -t1 * Math.SQRT1_2;
          t2 *= Math.SQRT1_2;
     
          // sumdiff(t1, x[i2], x[i4], x[i3]); // {s, d}  <--| {a+b, a-b}
          st1 = x[i2];
          x[i4] = t1 + st1; 
          x[i3] = t1 - st1;
          
          //sumdiff3(x[i1], t2, x[i2]); // {a, b, d} <--| {a+b, b, a-b}
          x[i2] = x[i1] - t2;
          x[i1] += t2;
        }
      } else {
        for(i0 = ix; i0 < n; i0 += id) {
          i1 = i0;
          i2 = i1 + n4;
          i3 = i2 + n4;
          i4 = i3 + n4;
     
          //diffsum3_r(x[i3], x[i4], t1); // {a, b, s} <--| {a, b-a, a+b}
          t1 = x[i3] + x[i4]; 
          x[i4] -= x[i3];
          
          //sumdiff3(x[i1], t1, x[i3]);   // {a, b, d} <--| {a+b, b, a-b}
          x[i3] = x[i1] - t1; 
          x[i1] += t1;
        }
      }
   
      ix = (id << 1) - n2;
      id = id << 2;
    } while (ix < n);
 
    e = TWO_PI / n2;

    for (var j = 1; j < n8; j++) {
      a = j * e;
      ss1 = Math.sin(a);
      cc1 = Math.cos(a);

      //ss3 = sin(3*a); cc3 = cos(3*a);
      cc3 = 4*cc1*(cc1*cc1-0.75);
      ss3 = 4*ss1*(0.75-ss1*ss1);
   
      ix = 0; id = n2 << 1;
      do {
        for (i0 = ix; i0 < n; i0 += id) {
          i1 = i0 + j;
          i2 = i1 + n4;
          i3 = i2 + n4;
          i4 = i3 + n4;
       
          i5 = i0 + n4 - j;
          i6 = i5 + n4;
          i7 = i6 + n4;
          i8 = i7 + n4;
       
          //cmult(c, s, x, y, &u, &v)
          //cmult(cc1, ss1, x[i7], x[i3], t2, t1); // {u,v} <--| {x*c-y*s, x*s+y*c}
          t2 = x[i7]*cc1 - x[i3]*ss1; 
          t1 = x[i7]*ss1 + x[i3]*cc1;
          
          //cmult(cc3, ss3, x[i8], x[i4], t4, t3);
          t4 = x[i8]*cc3 - x[i4]*ss3; 
          t3 = x[i8]*ss3 + x[i4]*cc3;
       
          //sumdiff(t2, t4);   // {a, b} <--| {a+b, a-b}
          st1 = t2 - t4;
          t2 += t4;
          t4 = st1;
          
          //sumdiff(t2, x[i6], x[i8], x[i3]); // {s, d}  <--| {a+b, a-b}
          //st1 = x[i6]; x[i8] = t2 + st1; x[i3] = t2 - st1;
          x[i8] = t2 + x[i6]; 
          x[i3] = t2 - x[i6];
         
          //sumdiff_r(t1, t3); // {a, b} <--| {a+b, b-a}
          st1 = t3 - t1;
          t1 += t3;
          t3 = st1;
          
          //sumdiff(t3, x[i2], x[i4], x[i7]); // {s, d}  <--| {a+b, a-b}
          //st1 = x[i2]; x[i4] = t3 + st1; x[i7] = t3 - st1;
          x[i4] = t3 + x[i2]; 
          x[i7] = t3 - x[i2];
         
          //sumdiff3(x[i1], t1, x[i6]);   // {a, b, d} <--| {a+b, b, a-b}
          x[i6] = x[i1] - t1; 
          x[i1] += t1;
          
          //diffsum3_r(t4, x[i5], x[i2]); // {a, b, s} <--| {a, b-a, a+b}
          x[i2] = t4 + x[i5]; 
          x[i5] -= t4;
        }
     
        ix = (id << 1) - n2;
        id = id << 2;
   
      } while (ix < n);
    }
  }

  while (--i) {
    rval = x[i];
    ival = x[n-i-1];
    mag = bSi * sqrt(rval * rval + ival * ival);

    if (mag > this.peak) {
      this.peakBand = i;
      this.peak = mag;
    }

    spectrum[i] = mag;
  }

  spectrum[0] = bSi * x[0];

  return spectrum;
};
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
ThreeAudio.Source = function (options) {
  if (typeof options == 'number') {
    options = { fftSize: options };
  }
  options = _.extend({
    fftSize: 1024,
    detectors: [ThreeAudio.LevelDetect, ThreeAudio.BeatDetect],
  }, options);

  this.fftSize = options.fftSize;
  this.detectors = options.detectors;

  this.filters = {};
  this.playing = false;

  this.processingDelay = 0;

  if (!(webkitAudioContext || AudioContext)) {
    throw "Web Audio API not supported";
  }
  else {
    this.initElement(options.element);
  }
}

ThreeAudio.Source.prototype = {

  initElement: function (element) {
    var c = this.context = new (webkitAudioContext || AudioContext)();

    // Create source
    if (element) {
      this.element = element;
    }
    else {
      this.element = new Audio();
      this.element.preload = 'auto';
    }

    // Create buffers for time/freq data.
    this.samples = this.fftSize / 2;
    this.data = {
      // High resolution FFT for frequency / time data
      freq: new Uint8Array(this.samples),
      time: new Uint8Array(this.samples),
      // Low resolution filtered signals, time data only.
      filter: {
        bass: new Uint8Array(this.samples),
        mid: new Uint8Array(this.samples),
        treble: new Uint8Array(this.samples)//,
      }//,
    };

    // Create audible/inaudible inputs for analysis
    this.audible = c.createDelayNode();
    this.inaudible = c.createDelayNode();

    // Wait for audio metadata before initializing analyzer
    if (this.element.readyState >= 3) {
      this.initAnalyzer();
    }
    else {
      this.element.addEventListener('canplay', function () {
        this.initAnalyzer();
      }.bind(this));
    }

  },

  initAnalyzer: function () {
    var c = this.context;

    this.source = c.createMediaElementSource(this.element);
    this.source.connect(this.audible);

    // Create main analyser
    this.analyser = c.createAnalyser();
    var fftSize = this.analyser.fftSize = this.fftSize;

    // Create filter nodes for bass/mid/treble signals.
    var parameters = {
      bass: {
        type: 0, // LOWPASS
        frequency: 160,
        Q: 1.2,
        gain: 2.0//,
      },
      mid: {
        type: 2, // BANDPASS
        frequency: 500,
        Q: 1.2,
        gain: 4.0//,
      },
      treble: {
        type: 1, //HIGHPASS
        frequency: 2000,
        Q: 1.2,
        gain: 3.0//,
      }//,
    };
    var filters = this.filters;
    _.each(parameters, function (spec, key) {
      var filter = c.createBiquadFilter();
      filter.key = key;
      filter.type = spec.type;
      filter.frequency.value = spec.frequency;
      filter.Q.value = spec.Q;

      // Create analyser for filtered signal.
      filter.analyser = c.createAnalyser();
      filter.analyser.fftSize = fftSize;

      // Create delay node to compensate for FFT lag.
      filter.delayNode = c.createDelayNode();
      filter.delayNode.delayTime.value = 0;

      // Create gain node to offset filter loss.
      filter.gainNode = c.createGainNode();
      filter.gainNode.gain.value = spec.gain;

      filters[key] = filter;
    });

    // Create playback delay to compensate for FFT lag.
    this.delay = c.createDelayNode();
    this.processingDelay = this.fftSize * 2 / c.sampleRate;
    this.delay.delayTime.value = this.processingDelay;

    // Connect main audio processing pipe
    this.audible.connect(this.analyser);
    this.inaudible.connect(this.analyser);

    // Connect audible output through
    this.audible.connect(this.delay);
    this.delay.connect(c.destination);

    // Connect secondary filters + analysers + gain.
    var audible = this.audible,
        inaudible = this.inaudible;
    _.each(filters, function (filter) {
      audible.connect(filter.delayNode);
      inaudible.connect(filter.delayNode);

      filter.delayNode.connect(filter);
      filter.connect(filter.gainNode);
      filter.gainNode.connect(filter.analyser);
    });

    // Create detectors
    this.detectors = _.map(this.detectors, function (klass) {
      return (new klass(this.data));
    }.bind(this));
  },

  update: function () {
    var a = this.analyser, d = this.data;

    if (a) {
      // Get freq/time data.
      a.smoothingTimeConstant = 0;
      a.getByteFrequencyData(d.freq);
      a.getByteTimeDomainData(d.time);

      // Get filtered signals.
      _.each(this.filters, function (filter) {
        filter.analyser.getByteTimeDomainData(d.filter[filter.key]);
      });

      // Update detectors.
      _.each(this.detectors, function (det) {
        det.analyse();
      });
    }

    return this;
  },

  size: function () {
    return this.analyser.frequencyBinCount;
  },

  mic: function (callback) {
    var c = this.context, inaudible = this.inaudible;
    try {
      navigator.webkitGetUserMedia({
          audio: true
        }, function (stream) {
          // Create an AudioNode from the stream.
          var mediaStreamSource = this.mediaStreamSource = c.createMediaStreamSource(stream);
          mediaStreamSource.connect(inaudible);

          callback && callback();
        });
    } catch (e) { };

    return this;
  },

  size: function () {
    return this.analyser.frequencyBinCount;
  },

  load: function (url, callback) {
    var context = this.context,
        source = this.source,
        that = this;

    var ping = function () {
      // Begin playback if requested earlier.
      if (that.playing) {
        that._play();
      }

      // Remove event listener
      that.element.removeEventListener('canplaythrough', ping);

      // Fire callback
      callback && callback();
    };

    // Add event listener for when loading is complete
    this.element.addEventListener('canplaythrough', ping);
    this.element.src = url;

    return this;
  },

  play: function () {
    this.playing = true;
    if (this.element.readyState == 4) {
      this._play();
    }
    return this;
  },

  stop: function () {
    this.playing = false;
    if (this.element.readyState == 4) {
      this._stop();
    }
    return this;
  },

  _play: function () {
    this.startTime = (+new Date() / 1000) - this.element.currentTime;
    this.element.play();
  },

  _stop: function () {
    this.element.pause();
  },

  time: function () {
    return this.startTime ? ((+new Date() / 1000) - this.startTime) : 0;
  },

};

// tQuery-like naming.
ThreeAudio.Source.prototype.start = ThreeAudio.Source.prototype.play;
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
ThreeAudio.Textures = function (renderer, source, history) {

  this.renderer = renderer;
  this.source = source;
  this.textures = {};

  this.history = history || 128;
  this.timeIndex = 0;

  this.data = source.data;

  this.init();
}

ThreeAudio.Textures.prototype = {

  init: function () {
    var renderer = this.renderer,
        gl = renderer.getContext(),
        textures = this.textures,
        data = this.data,
        history = this.history,
        t, d, empty;

    // Create textures for frequency/time domain data.
    _.each(['freq', 'time'], function (key) {

      if (textures[key]) {
        gl.deleteTexture(textures[key]);
  			renderer.info.memory.textures--;
      }
      t = textures[key] = gl.createTexture();
			renderer.info.memory.textures++;

      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      d = data[key];
      empty = new Uint8Array(d.length * history);
      if (key == 'time') {
        for (var i = 0; i < d.length * history; ++i) empty[i] = 128;
      }

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, d.length, history, 0, gl.ALPHA, gl.UNSIGNED_BYTE, empty);
    });
  },

  update: function () {
    var renderer = this.renderer,
        gl = renderer.getContext(),
        textures = this.textures,
        source = this.source,
        history = this.history,
        index = this.timeIndex,
        data = source.data;

    // Ensure audio data is up to date
    source.update();

    // Update textures for frequency/time domain data.
    _.each(['freq', 'time'], function (key) {
      gl.bindTexture(gl.TEXTURE_2D, textures[key]);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, index, data[key].length, 1, gl.ALPHA, gl.UNSIGNED_BYTE, data[key]);
    });

    // Notify all linked materials of updated uniforms.
    this.emit('update', this.uniforms());

    // Circular buffer index
    this.timeIndex = (index + 1) % history;
  },

  get: function () {
    return this.textures;
  },

  uniforms: function () {
    var levels = this.data.levels,
        beat = this.data.beat;
    return {
      audioIsBeat:       beat && beat.is || 0,
      audioWasBeat:      beat && beat.was || 0, 
      audioLevels:       levels && levels.direct || 0,
      audioLevelsSmooth: levels && levels.smooth || 0,
      audioLevelsChange: levels && levels.change || 0,
      audioOffset:       this.timeIndex / this.history,
      audioStep: {
        x: 1 / (this.source.samples - 1),
        y: 1 / this.history,
      },
    };
  },
}

// Event emitter
MicroEvent.mixin(ThreeAudio.Textures);
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
/**
 * Audio analyser: provide RMS levels + filters / derivatives.
 */
ThreeAudio.LevelDetect = function (data) {
  this.data = data;

  this.levels = [[0, 0, 0, 0]];
  this.smooth = [0, 0, 0, 0];
  this.change = [0, 0, 0, 0];

  // Add output structure to data.
  data.levels = {
    direct: this.levels[0],
    smooth: this.smooth,
    change: this.change,
  };
};

ThreeAudio.LevelDetect.prototype.analyse = function () {
  var data = this.data,
      levels = this.levels,
      smooth = this.smooth,
      change = this.change,
      bins = [0, 0, 0, 0];

  // Calculate RMS of time data.
  function rms(data) {
    var size = data.length, accum = 0;
    for (var i = 0; i < size; ++i) {
      var s = (data[i] - 128) / 128;
      accum += s*s;
    }
    return Math.sqrt(accum / size);
  }

  // Calculate energy level for all bins.
  var waveforms = [data.time, data.filter.bass, data.filter.mid, data.filter.treble];
  for (var j = 0; j < 4; ++j) {
    bins[j] = rms(waveforms[j]);
  }

  // Keep 7 last level values
  levels.unshift(bins);
  if (levels.length > 7) levels.pop();

  // Filter helpers
  var accum, factors, gain, decay, samples;

  // Calculate averages over 3 frames
  factors = [1, 2, 1], gain = 4, samples = Math.min(levels.length, factors.length);
  for (var i = 0; i < 4; ++i) {
    accum = 0;
    for (var j = 0; j < samples; ++j) {
      accum += (levels[j] && levels[j][i] || 0) * factors[j];
    }
    smooth[i] = accum / gain;
  }

  // Calculate difference over 6 frames
  factors = [1, 3, 2, -2, -3, -1], gain = 1, decay = .5, samples = Math.min(levels.length, factors.length);
  for (var i = 0; i < 4; ++i) {
    accum = 0;
    for (var j = 0; j < samples; ++j) {
      accum += (levels[j] && levels[j][i] || 0) * factors[j];
    }
    // Apply additional decay filter to make less erratic.
    change[i] = change[i] + (accum / gain - change[i]) * decay;
  }

  // Write results to data structure.
  this.data.levels.direct = this.levels[0];
  // Smooth / change updated by reference.
}
/**
 * Audio analyser: provide beat detection
 *
 * It works in two stages:
 * - Uses autocorrelation of the RMS of the signal over time to find the BPM.
 * - Uses energy detection to find major beats, and predicts missing beats using the BPM.
 *
 * The autocorrelation helps figure out complicated drum patterns,
 * while the prediction helps smooth out the noise.
 *
 * Any piece of periodic music will be periodic in its autocorrelation.
 * This translates into a base frequency + harmonics in the frequency domain. By finding
 * the peaks of the frequency domain and matching up the harmonics, we can identify the
 * dominant BPM. Peaks are interpolated quadratically and tracked across frames to
 * rank them by strength and permanence.
 *
 * Energy detection uses short filters and differentiation to find 'impulses'. These are used
 * to seed the prediction of the next beat. This prediction is constantly adjusted as new
 * impulses come in. The more accurate the prediction, the more locked in the pattern is and
 * the more energy is needed to reset it. If too many beats are mispredicted, prediction stops
 * and it tries to find the beat again.
 *
 * If the variance between detected beats becomes small enough (minus outliers),
 * the BPM is locked in and the autocorrelator is ignored to help ride through quiet sections.
 *
 * Works well for anything with a regular beat.
 *
 * Uses the levels of LevelDetect as input.
 */
var __taDebug = false;

ThreeAudio.BeatDetect = function (data) {
  this.data = data;

  // Add output structure to data.
  data.beat = {
    permanence: 0,
    confidence: 0,
    missed: false,
    predicted: false,
    maybe: false,
    is: false,
    was: 0,
    stddev: 0,
    bpm: 0,
  };

  __taDebug && this.initDebug();

  // Sample buffers
  this.n = 512;
  this.history = [[],[],[]];
  this.buffer = new Float32Array(this.n);
  this.spectrum = null;
  this.fft = new FFT(this.n, 44100);
  this.sample = 0; // Sample to feed into the autocorrelator
  this.background = 0; // Long-term energy level
  this.energy = 0; // Short-term energy level
  this.signal = 0; // Signal as distinguished from background
  this.measure = 0; // Frames since last beat
  this.maybe = 0; // Heuristic for instant beat detection
  this.maxMaybe = 0; // Normalization for maybe
  this.debounceMaybe = 0; // Debounce maybe beats
  this.debouncePredict = 0; // Debounce predicted beats
  this.decay = 0; // Decay value for beat flasher
  this.intervals = []; // Inter-beat intervals
  this.mean = 0; // Mean of beat intervals
  this.stddev = 0; // Variance/stddev in beat intervals
  this.jitter = 0; // Range to adjust to
  this.missed = 3;  // Missed beats score
  this.found = 0;   // Found beats score
  this.predicted = false; // Whether last predicted beat was used.
  this.green = 0; // Number of good beats found in succession

  // Acceptable range 50-300 bpm
  this.fMin = Math.floor(this.bpmToOffset(50));
  this.fMax = Math.ceil(this.bpmToOffset(400));

  // Histogram of autocorrelation peaks seen
  this.histogram = {};
  this.histogramSorted = [];
  this.beat = null;
  this.frames = 0;
};

ThreeAudio.BeatDetect.prototype = {
  initDebug: function () {
    this.c = document.createElement('canvas');
    this.c.className = 'ta-debug';
    this.c.width = 512;
    this.c.height = 340;
    this.c.style.position = 'absolute';
    this.c.style.zIndex = 20;
    this.c.style.marginTop = '70px';
    this.c.style.top = 0;
    this.g = this.c.getContext('2d');
    this.i = 0;

    this.t = document.createElement('div');
    this.t.className = 'ta-debug';
    this.t.width = 256;
    this.t.height = 200;
    this.t.style.background = 'rgba(0,0,0,.3)';
    this.t.style.color = '#fff';
    this.t.style.fontSize = '10px';
    this.t.style.position = 'absolute';
    this.t.style.zIndex = 20;
    this.t.style.marginTop = '350px';
    this.c.style.top = 0;

    document.body.appendChild(this.c);
    document.body.appendChild(this.t);
  },

  bpmToOffset: function (bpm) {
    return this.n * bpm / (60 * 60); // Assume 60 fps
  },

  offsetToBPM: function (freq) {
    return 60 * 60 * freq / this.n; // Assume 60 fps
  },

  analyse: function () {
    var data = this.data,
        levels = data.levels,
        buffer = this.buffer,
        fft = this.fft,
        n = this.n,
        history = this.history,
        histogram = this.histogram,
        histogramSorted = this.histogramSorted,
        that = this;

    // Prepare beat data
    data.beat.missed = false;
    data.beat.maybe = false;
    data.beat.is = false;
    data.beat.predicted = false;
    data.beat.locked = false;
    data.beat.adjusted = false;
    if (this.beat) {
      data.beat.confidence = this.beat.confidence;
      data.beat.permanence = this.beat.permanence;
      data.beat.bpm = this.beat.bpm;
    }
    else {
      data.beat.confidence = 0;
      data.beat.permanence = 0;
      data.beat.bpm = '';
    }

    // Process energy to find impulses of sound
    var energy = levels.direct[0];

    // Separate signal from background
    this.background = this.background + (energy - this.background) * .2;
    this.energy = this.energy + (energy - this.energy) * .4;
    var signal = (this.energy - this.background) / (1 - this.background) * 3;
    this.signal = signal;

    // Normalize and threshold for 'maybe' beat value.
    var lastMaybe = this.maybe;
    maybe = signal;
    this.maxMaybe = Math.max(this.maxMaybe * .99, maybe);
    this.maybe = maybe = maybe / Math.max(.2, this.maxMaybe) - .7;

    // Calculate sample to autocorrelate
    var sample = signal;
    this.sample = signal;

    // Keep track of sound levels up to n samples.
    history.unshift(signal);
    while (history.length > n) history.pop();

    // Update float buffer
    buffer.set(history);

    // Calculate autocorrelation of buffer in frequency domain.
    fft.forward(buffer);
    var spectrum = this.spectrum = fft.real, real = fft.real, imag = fft.imag;
    for (var i = 0; i < n; ++i) {
      spectrum[i] = real[i] * real[i] + imag[i] * imag[i];
    }

    // Find maximum of autocorrelation spectrum in region of interest.
    var spectrumMax = 0;
    for (var i = 2; i < n/8; ++i) {
      spectrumMax = Math.max(spectrumMax, spectrum[i]);
    }

    // Find peaks in autocorrelation spectrum.
    var peaks = {};
    var cutoff = spectrumMax / 16; // Ignore peaks less than 1/16th of maximum.
    for (var i = this.fMin + 1; i < this.fMax; ++i) {
      var energy = spectrum[i];
      if (energy > cutoff) {
        var max = Math.max(spectrum[i - 1], spectrum[i + 1]);
        // Is this point higher than its neighbours?
        if (energy > max) {
          var min = Math.min(spectrum[i - 1], spectrum[i + 1]);
          var diff = Math.abs(energy - min),
              discriminant = diff / energy;

          // Peak must dip 50% on at least one side
          if (discriminant > .5) {
            var strength = Math.sqrt(energy / spectrumMax);
            peaks[i] = strength;
          }
        }
      }
    }

    // Decay all peak strengths
    _.each(histogramSorted, function (peak, key) {
      peak.permanence = peak.permanence * .99;
      decay = Math.min(1, (Math.log(1 + peak.permanence) / Math.log(10)));
      peak.strength = peak.strength * decay;
      peak.active = false;
    });

    // Find fractional offset of each peak and add to histogram
    _.each(peaks, function (strength, i) {
      // Cast key to int.
      i = +i;

      // Get neighbouring points
      var l = spectrum[i-1],
          m = spectrum[i],
          r = spectrum[i+1];

      // Use quadratic fit to interpolate
      var a2 = (l + r) - m * 2;
          b = (r - l) / 2,
          fraction = -b/a2;

      // Add peak to histogram
      var peak = histogram[i];
      if (!peak) {
        // See if we need to move a neighbouring peak over.
        if (peak = histogram[i+1]) {
          delete histogram[i+1];
          peak.index = i;
          peak.fraction += 1;
          histogram[i] = peak;
        }
        else if (peak = histogram[i-1]) {
          delete histogram[i-1];
          peak.index = i;
          peak.fraction -= 1;
          histogram[i] = peak;
        }
        // Create new peak
        else {
          peak = histogram[i] = {
            index: i,
            fraction: fraction,
            offset: 0,
            strength: 0,
            permanence: 0,
            score: 0,
            window: 0,
          };
          histogramSorted.push(peak);
        }
      }

      // Update histogram peak
      peak.fraction = peak.fraction + (fraction - peak.fraction) * .1;
      peak.strength = strength;
      peak.permanence += peak.strength * .01;
      peak.offset = peak.index + peak.fraction;
      peak.bpm = that.offsetToBPM(peak.offset);
      peak.window = n / (peak.offset);
      peak.active = true;
    });

    // Sort histogram by permanence
    histogramSorted.sort(function (a, b) {
      return b.permanence - a.permanence;
    });

    // Cull peaks with too low a value.
    var last;
    while ((last = histogramSorted[histogramSorted.length - 1]) && (last.strength < 0.01)) {
      histogramSorted.splice(histogramSorted.length - 1, 1);
      delete histogram[last.index];
    }

    // Compare peaks against reference peak
    function comparePeaks(reference) {
      var result = 0, cutoff = reference.offset * 1.5;

      // Pairwise comparison
      _.each(histogramSorted, function (peak) {
        if (peak == reference) return;
        if (peak.offset < cutoff) return;

        // Calculate match value based on narrow window around integer ratios.
        var ratio = peak.offset / reference.offset,
            match = Math.max(0, 1 - Math.abs(ratio - Math.round(ratio)) * 4);

        // Scale by peak strength
        strength = peak.strength * peak.permanence * ratio;
        result += match * strength;
      });

      return result;
    }

    // Figure out the true BPM by finding sets of peaks that are multiples of each other.
    var h = histogramSorted.length, fMin = this.fMin,
        score = 0, second = 0, beat = null;
    _.each(histogramSorted, function (reference) {
      var accum = 0;

      if (reference.offset < fMin) return;
      var result = comparePeaks(reference);

      if (result > accum) {
        accum = result;
      }

      // Add this peak's strength
      accum += reference.strength * reference.permanence;
      reference.score = accum;

      // Keep track of two maximum values.
      if (accum > score) {
        beat = reference;
        second = score;
        score = accum;
      }
      else if (accum > second) {
        second = accum;
      }
    });

    // See if new BPM is better.
    if (beat) {
      // Score based on first and second BPM strength.
      beat.score = score ? (1 - second / score) : 0;

      // Confidence = score x permanence
      beat.confidence = Math.min(1, beat.score + beat.permanence);

      // Only pick new BPM if it has higher confidence.
      if (this.beat) {
        if (this.beat.confidence < beat.confidence) {
          // Accept new bpm.
          this.beat = beat;
        }
        else if (this.beat != beat) {
          // Decay current confidence.
          this.beat.confidence *= 0.95;
        }
      }
      else {
        // Accept new bpm.
        this.beat = beat;
      }

      // Limit BPM to a more reasonable range
      if (this.beat.bpm > 240) {
        this.beat.bpm /= 2;
        this.beat.window *= 2;
      }
    }

    // Constants for rejection algorithm.
    var foundBonus = 3,
        missedPenalty = 1,
        maxPenalty = 10,
        maxFound = 10,
        debounceFrames = 5;

    var lastMeasure = this.measure;

    // Choose window for beat prediction based on accuracy
    var beatWindow = 0;
    if (this.beat) {
      beatWindow = this.beat.window;
      // If beat intervals are regular, we've locked in to the beat
      if (this.mean && (this.stddev < 2)) {
        beatWindow = this.mean;
        data.beat.locked = true;
        data.beat.bpm = this.offsetToBPM(this.n / beatWindow);
      }
    }

    // Find a maybe beat to get started.
    if (maybe > 0 && lastMaybe <= 0 && this.debounceMaybe > debounceFrames) {
      // Ignore rapid maybe beats in succession
      this.debounceMaybe = 0;

      // Prediction is not working, use maybe beat.
      if (!this.beat || (!data.beat.locked && this.beat.confidence < .3)) {
        // Accept as real beat and reset measure
        this.measure = 0;
        data.beat.is = true;
        data.beat.maybe = true;
      }
      else if (this.beat) {

        // See how well this maybe beat matches our model
        var half = this.beat.window / 2;
        var offset = ((this.measure + half) % beatWindow) - half;
        var jitter = this.jitter && Math.max(3, Math.min(this.jitter + 1, 10)) || 10;

        // Realign beat if close to prediction
        if (Math.abs(offset) < jitter) {
          this.measure = 0;

          // If prediction is late, pre-empt it.
          // If prediction was early but dropped, restore it.
          if ((offset <= 1 && this.debouncePredict > debounceFrames)
           || !this.predicted) {
            data.beat.is = true;
            if (offset >= 0) data.beat.predicted = true;
            this.debouncePredict = 0;

            this.found = Math.min(maxFound, this.found + 1);

            // Count as beat for interval measurement
            data.beat.adjusted = true;
          }
          else {
            // Ignore beat, prediction was early and used.
            data.beat.maybe = true;

            // Undo penalties from last miss
            this.found = Math.min(maxFound, this.found + 1);
            this.missed = Math.max(0, this.missed - missedPenalty);
          }

          // Give bonus for found beat
          this.found = Math.min(maxFound, this.found + 1);
          this.missed = Math.max(0, this.missed - foundBonus);
        }
        // Reset if there is a powerful enough impulse. Be more generous the more we've missed.
        else if ((maybe > (1 + this.found*.2  + .5/this.stddev - this.missed / maxPenalty))
              || (this.found == 0 || this.missed > 4)) {
          this.measure = 0;
          data.beat.is = true;
          this.debouncePredict = 0;

          // Give bonus for found beat
          this.found = Math.min(maxFound, this.found + 1);
          this.missed = Math.max(0, this.missed - foundBonus);
        }
        else {
          // Ignore maybe beat
          data.beat.maybe = true;
        }
      }
    }

    // Predict a beat.
    if (this.beat && (this.beat.confidence > .3)) {
      // Debounce predictions
      var debounce = this.debouncePredict > debounceFrames;

      // See if we passed beat.window samples.
      var predict = this.measure >= beatWindow;
      if (predict) {
        this.measure -= beatWindow;
      }

      // Check if prediction matches sound.
      if (predict && debounce) {
        if (maybe < 0) {
          // Give penalty for missed beat
          this.found = Math.max(0, this.found - 1);
          this.missed = Math.min(maxPenalty, this.missed + missedPenalty);
          data.beat.missed = true;
          data.beat.predicted = true;
        }
        else {
          // Give bonus for found beat
          this.found = Math.min(maxFound, this.found + 1);
          this.missed = Math.max(0, this.missed - foundBonus);
        }

        if (this.found < 1) {
          // Ignore prediction if not certain yet
          predict = false;
          data.beat.maybe = true;
          data.beat.predicted = true;
          this.debouncePredict = 0;
        }
        else if (this.missed > 4) {
          // Previous 4 beats were mispredicted
          predict = false;
          data.beat.maybe = true;
          data.beat.predicted = true;

          // Shift decounce randomly to attempt to hit the right beat.
          this.measure += Math.random() * debounceFrames;
          this.debounceMaybe += Math.random() * debounceFrames;
          this.debouncePredict = 0;
        }

        this.predicted = predict;
      }

      // If prediction not rejected, use it.
      if (predict && debounce) {
        this.debouncePredict = 0;
        data.beat.is = true;
        data.beat.predicted = true;
      }
    }

    // Analyse beats for consistency.
    var interval = 0;

    // Don't check interval if beats are being missed.
    if (this.missed > 3) {
      this.green = 0;
    }
    // Measure intervals between beats
    else if (data.beat.is || data.beat.adjusted) {
      if (this.green++) {
        // Use beat BPM
        interval = this.frames - this.lastGreen;
      }
      this.lastGreen = this.frames;
    }
    if (interval) {
      var intervals = this.intervals;

      // Keep track of last 12 intervals
      intervals.unshift(lastMeasure);
      if (intervals.length > 12) {
        intervals.pop();
      }

      // Remove outliers, keep middle half.
      var working = intervals.slice();
      working.sort();
      working = working.slice(2, 10);

      // Calculate mean/stddev
      if (working.length > 6) {
        var sum = 0, variance = 0;
        l = working.length;
        for (var i = 0; i < l; ++i) {
          sum += working[i];
          variance += working[i] * working[i];
        }
        sum /= l;
        variance /= l;

        this.mean = sum;
        this.stddev = Math.sqrt(variance - sum*sum);
      }
    }

    // Lock in on a wider range if missed
    this.jitter = (this.stddev + this.missed * .5) * (1 + this.missed);

    // Provide decayed beat value
    this.decay = this.decay + (+data.beat.is * 2.5 - this.decay) * .4;
    data.beat.was = data.beat.was + (this.decay * 2.5 - data.beat.was) * .4;

    // Advance a frame.
    this.debounceMaybe++;
    this.debouncePredict++;
    this.measure++;
    this.frames++;

    //////////////
    __taDebug && this.debug();
  },


  // Draw debug info into canvas / dom
  debug: function () {
    var levels = this.data.levels.direct,
        sample = this.sample,
        diff = this.signal,
        maybe = this.maybe,
        spectrum = this.spectrum,
        histogram = this.histogram,
        beat = this.data.beat,
        mean = this.mean,
        stddev = this.stddev;

    var that = this;
    var n = this.n;

    // Mark histogram beats according to active BPM.
    if (this.beat) {
      var reference = this.beat;
      var cutoff = reference.offset * 1.5;
      _.each(histogram, function (peak) {
        var match = (peak == reference ? 1 : 0);
        if (peak.offset > cutoff) {
          // Calculate match value based on narrow window around integer ratios.
          var ratio = peak.offset / reference.offset;
          match = Math.max(0, 1 - Math.abs(ratio - Math.round(ratio)) * 4);
        }
        peak.match = match;
      });
    }

    var locked = beat.locked ? ' style="color: rgb(180,255,0)"' : '';

    var out = [ '<strong><span'+locked+'>' + Math.round(beat.bpm * 10) / 10
              + ' BPM </span> (' + Math.round(100 * beat.confidence)
              + '%) P:' + Math.round(beat.permanence * 100)
              + ' µ = ' + Math.round(this.mean * 10) / 10
              + ' σ = '+ Math.round(this.stddev * 100) / 100
              +'</strong> '+ this.found + 'f ' + this.missed +'m'];

    _.each(histogram, function (peak) {
      var bpm = Math.round(that.offsetToBPM(peak.offset) * 10) / 10;
      out.push([
        bpm, ' bpm - ',
        Math.round(peak.strength * 100), '%',
        ' P: ', Math.round(peak.permanence * 100)].join(''));
    });
    this.t.innerHTML = out.join('<br>');

    var g = this.g;

    // Draw graph bg
    g.fillStyle = '#000000';
    g.fillRect(0, 169, 512, 102);

    // Draw spectrum
    var max = 0;
    for (var i = 2; i < n/8; ++i) {
      max = Math.max(spectrum[i], max);
    }
    var norm = 1/max;
    g.beginPath();
    g.moveTo(0, 270);
    for (var i = 2; i < n/8; ++i) {
      g.lineTo((i-2)*8, 270-(spectrum[i]*norm)*100);
    }
    g.strokeStyle = '#ffffff';
    g.stroke();

    // Highlight peaks
    _.each(histogram, function (peak) {
      var alpha = peak.strength *.75 + .25;
      var color = peak.active ? [Math.round(255 - 195 * peak.match), Math.round(180 + 40 * peak.match), 0].join(',') : '255,10,10';
      g.fillStyle = 'rgba('+color+','+ alpha +')';
      g.fillRect((peak.offset - 2) * 8, 170, 1, 100);
    })

    // Plot levels voiceprint
    var i = this.i;
    var j = 0;
    function plot(l) {
      l = Math.round(Math.max(0, Math.min(255, l * 255)));
      g.fillStyle = 'rgb(' + [l,l,l].join(',') + ')';
      g.fillRect(i, j, 1, 20)
      j += 20;
    }

    //plot(levels[0]);
    plot(levels[1]);
    plot(levels[2]);
    plot(levels[3]);
    plot(0);
    plot(0);
    plot(0);
    plot(0);
    plot(0);

    // Show time bar
    g.fillStyle = 'rgba(160,160,255,.85)';
    g.fillRect(i+1, 0, 2, 120)

    // Show beats
    if (beat.is) {
      g.fillStyle = beat.missed ? 'rgba(255,0,0,.7)'
                    : (beat.maybe ? 'rgba(0,180,255,.9)'
                    : (beat.predicted ? 'rgba(255,200,0,1)' : 'rgba(60,220,0,1)'));
      g.fillRect(this.i, 120, 2, 40)
    }
    var c = Math.round(Math.max(0, Math.min(255, beat.was * 255)));
    g.fillStyle = 'rgb('+c+','+c+','+c+')';
    g.fillRect(342, 270, 170, 30)

    // Show maybe beats
    if (beat.maybe && !beat.is) {
      g.fillStyle = 'rgba(64,64,64,.75)';
      g.fillRect(this.i, 120, 2, 40)
    }

    // Show sample
    sample = Math.floor(Math.max(0, Math.min(1, sample*1.4+.5)) * 255);
    g.fillStyle = 'rgba('+Math.round(sample*.2)+','+Math.round(sample*.6)+',' + sample +',1)';
    g.fillRect(this.i, 60, 1, 20)

    // Show diff
    diff = Math.floor(Math.max(0, Math.min(1, diff*2)) * 255);
    g.fillStyle = 'rgba('+Math.round(diff*.2)+','+Math.round(diff)+','+ Math.round(diff*.5) +',1)';
    g.fillRect(this.i, 80, 1, 20)

    // Show maybe
    maybe = (beat.is || beat.maybe) ? Math.floor(Math.max(0, Math.min(1, maybe*1.2 + .5)) * 255) : 0;
    g.fillStyle = 'rgba('+Math.round(maybe)+',' + maybe +','+Math.round(maybe)+',1)';
    g.fillRect(this.i, 100, 1, 20)

    this.i = (i + 1) % 512;

  }

}
