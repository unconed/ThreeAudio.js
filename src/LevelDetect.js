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
