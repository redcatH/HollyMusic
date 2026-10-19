/* global modules */
// 由 check-equalizer-response.mjs 注入实际生产模块，在原生浏览器中执行。
window.testResult = (async () => {
  const eq = modules['./equalizer']
  const { createEqualizerAutomation } = modules['./equalizer-automation']
  const rates = [22050, 32000, 44100, 48000, 96000]
  const limits = {
    modelDb: 0.0001, centerDb: 0.05,
    metadataMaxDifference: 1e-7,
    // 项目旁路验收目标：幅度偏差 <0.1dB，含相位误差的归一化 RMS <1%。
    // 不要求原生 IIR 在自动化结束后逐位还原；保存元数据仍用独立严格对照。
    bypassGainDb: 0.1, bypassRelativeRms: 0.01,
  }

  function createGraph(context, fallback = false) {
    const filters = eq.EQ_FREQUENCIES.map((frequency, i) => {
      const node = context.createBiquadFilter()
      node.type = 'peaking'
      node.frequency.value = eq.filterFrequency(frequency, context.sampleRate)
      node.Q.value = eq.filterQ(i, context.sampleRate)
      return node
    })
    const preamp = context.createGain(), protection = context.createGain()
    filters.forEach((node, i) => node.connect(filters[i + 1] ?? preamp))
    preamp.connect(protection)
    if (fallback) {
      for (const node of [...filters, preamp, protection]) {
        Object.defineProperty(node.gain, 'cancelAndHoldAtTime', { value: undefined })
      }
    }
    return { filters, preamp, protection }
  }

  let maxErrorDb = 0, maxCenterErrorDb = 0, cases = 0
  for (const rate of rates) {
    const context = new OfflineAudioContext(1, 128, rate)
    for (const preset of [...eq.EQ_PRESETS, { bands: Array(10).fill(12) }]) {
      const frequencies = eq.responseFrequencies(rate)
      const design = eq.designEqualizer(preset.bands, rate)
      const predicted = eq.equalizerResponse(design.gains, rate, frequencies)
      const actual = new Float64Array(frequencies.length)
      maxCenterErrorDb = Math.max(maxCenterErrorDb, design.maxError)
      const { filters } = createGraph(context)
      filters.forEach((node, i) => {
        node.gain.value = design.gains[i]
        const magnitude = new Float32Array(frequencies.length), phase = new Float32Array(frequencies.length)
        node.getFrequencyResponse(frequencies, magnitude, phase)
        for (let j = 0; j < frequencies.length; j++) actual[j] += 20 * Math.log10(magnitude[j])
      })
      for (let j = 0; j < frequencies.length; j++) maxErrorDb = Math.max(maxErrorDb, Math.abs(actual[j] - predicted[j]))
      cases++
    }
  }
  const response = { cases, maxErrorDb, maxCenterErrorDb, passed: maxErrorDb < limits.modelDb && maxCenterErrorDb < limits.centerDb }

  const continuity = [], bypass = []
  for (const fallback of [false, true]) for (const mode of ['dc', 'eq']) {
    const rate = 48000, context = new OfflineAudioContext(1, 2 * rate, rate)
    const { filters, preamp, protection } = createGraph(context, fallback)
    protection.connect(context.destination)
    let time = 0
    const clock = { sampleRate: rate, get currentTime() { return time } }
    let settings = { ...eq.defaultEqualizer(), enabled: true, autoPreamp: mode !== 'dc' }
    const automation = createEqualizerAutomation(clock, filters, preamp, protection, settings)
    let source
    if (mode === 'dc') {
      source = context.createConstantSource()
      source.offset.value = 0.2
      source.connect(filters[0])
    } else {
      source = context.createOscillator()
      source.frequency.value = 1000
      const level = context.createGain()
      level.gain.value = 0.05
      source.connect(level)
      level.connect(filters[0])
    }
    source.start()
    for (let i = 0; i < 40; i++) {
      time = 0.1 + i * 0.008
      settings = { ...settings, preamp: i % 2 ? -12 : 6,
        bands: mode === 'eq' ? Array.from({ length: 10 }, (_, band) => (i + band) % 2 ? -12 : 12) : settings.bands }
      automation.update(settings)
    }
    time = 0.5
    automation.update({ ...settings, enabled: false })
    const samples = (await context.startRendering()).getChannelData(0)
    let maxAdjacentJump = 0, peak = 0
    for (let i = 1; i < samples.length; i++) {
      if (i >= rate * 0.09) maxAdjacentJump = Math.max(maxAdjacentJump, Math.abs(samples[i] - samples[i - 1]))
      peak = Math.max(peak, Math.abs(samples[i]))
    }
    continuity.push({ fallback, mode, maxAdjacentJump, peak,
      passed: maxAdjacentJump < (mode === 'dc' ? 0.002 : 0.03) && peak < (mode === 'dc' ? 0.41 : 0.15) })
    const frequency = mode === 'dc' ? 0 : 1000
    const dry = await render(rate, frequency, false, 'dry')
    if (mode === 'eq') for (let i = 0; i < dry.length; i++) dry[i] *= 0.25
    bypass.push({ scenario: 'rapid-' + mode, rate, frequency, fallback, ...compareBypass(samples, dry, rate) })
  }

  // 同一输入、图、设置及旁路时刻，只改变预设元数据操作。
  async function render(rate, frequency, fallback, mode) {
    const context = new OfflineAudioContext(1, 2 * rate, rate)
    const input = context.createBuffer(1, 2 * rate, rate)
    const samples = input.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = frequency ? 0.2 * Math.sin(2 * Math.PI * frequency * i / rate) : 0.2
    const source = context.createBufferSource()
    source.buffer = input
    if (mode === 'dry') source.connect(context.destination)
    else {
      const { filters, preamp, protection } = createGraph(context, fallback)
      const output = context.createGain()
      // 故意注入 0.1dB 旁路增益错误，验证稳态判据能拒绝回归。
      output.gain.value = mode === 'wrong-bypass' ? Math.pow(10, 0.1 / 20) : 1
      protection.connect(output)
      output.connect(context.destination)
      source.connect(filters[0])
      let time = 0
      const clock = { sampleRate: rate, get currentTime() { return time } }
      let settings = { ...eq.defaultEqualizer(), enabled: true, preamp: -12,
        bands: [...eq.EQ_PRESETS.find(p => p.id === 'rock').bands] }
      const automation = createEqualizerAutomation(clock, filters, preamp, protection, settings)
      if (mode === 'save' || mode === 'wrong-save') {
        for (let i = 0; i < 40; i++) {
          time = 0.1 + i * 0.008
          settings = { ...settings, preset: 'user-' + i, bands: [...settings.bands] }
          if (mode === 'wrong-save' && i === 20) settings.preamp += 0.1
          automation.update(settings)
        }
      }
      time = 0.5
      automation.update({ ...settings, enabled: false })
    }
    source.start()
    return (await context.startRendering()).getChannelData(0)
  }

  function maxDifference(actual, expected) {
    let difference = 0
    for (let i = 0; i < actual.length; i++) difference = Math.max(difference, Math.abs(actual[i] - expected[i]))
    return difference
  }

  function compareBypass(actual, dry, rate) {
    let diffPower = 0, dryPower = 0, actualPower = 0
    // 0.5s 关闭，1s 开始测量，留足保护释放与滤波器稳定时间。
    for (let i = rate; i < actual.length; i++) {
      diffPower += (actual[i] - dry[i]) ** 2
      dryPower += dry[i] ** 2
      actualPower += actual[i] ** 2
    }
    const relativeRmsError = Math.sqrt(diffPower / dryPower)
    const gainErrorDb = 10 * Math.log10(actualPower / dryPower)
    return { relativeRmsError, gainErrorDb,
      passed: relativeRmsError < limits.bypassRelativeRms && Math.abs(gainErrorDb) < limits.bypassGainDb }
  }

  const metadata = [], negativeControls = []
  for (const rate of rates) for (const frequency of [0, 31, 125, 1000, 8000, Math.min(16000, rate * 0.4)]) {
    const dry = await render(rate, frequency, false, 'dry')
    for (const fallback of [false, true]) {
      const control = await render(rate, frequency, fallback, 'control')
      const saved = await render(rate, frequency, fallback, 'save')
      const difference = maxDifference(saved, control)
      metadata.push({ rate, frequency, fallback, maxDifference: difference, passed: difference < limits.metadataMaxDifference })
      bypass.push({ scenario: 'negative-preamp', rate, frequency, fallback, ...compareBypass(control, dry, rate) })
      if (rate === 48000 && frequency === 1000) {
        const wrongSave = await render(rate, frequency, fallback, 'wrong-save')
        const wrongBypass = await render(rate, frequency, fallback, 'wrong-bypass')
        negativeControls.push({ fallback,
          rejectedSave: maxDifference(wrongSave, control) >= limits.metadataMaxDifference,
          rejectedBypass: !compareBypass(wrongBypass, dry, rate).passed })
      }
    }
  }
  return {
    browser: navigator.userAgent, limits, response, continuity, metadata, bypass, negativeControls,
    passed: response.passed && [...continuity, ...metadata, ...bypass].every(result => result.passed)
      && negativeControls.every(result => result.rejectedSave && result.rejectedBypass),
  }
})()
