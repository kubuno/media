import { useState, useCallback } from 'react'
import { audioEngine, EQ_PRESETS, DEFAULT_EQ, type EqState } from '../../../store/audioEngine'

const BAND_LABELS = ['32', '64', '130', '270', '560', '1k', '2k', '4k', '8k', '16k']
const PRESET_NAMES = ['flat', 'pro', 'dance', 'club', 'acoustic', 'drums', 'rock', 'bass', 'treble', 'vocal']
const MIN_DB = -12
const MAX_DB =  12

// ── Vertical EQ slider ────────────────────────────────────────────────────────

function EqSlider({ value, onChange, label }: {
  value: number; onChange: (v: number) => void; label: string
}) {
  return (
    <div className="flex flex-col items-center gap-1" style={{ width: 28 }}>
      <span className="text-[9px] font-mono text-amber-400/80" style={{ minWidth: 22, textAlign: 'center' }}>
        {value > 0 ? `+${value}` : value}
      </span>
      <div className="relative flex-1 flex items-center justify-center" style={{ height: 120 }}>
        <input
          type="range"
          min={MIN_DB}
          max={MAX_DB}
          step={1}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            writingMode:      'vertical-lr',
            direction:        'rtl',
            WebkitAppearance: 'slider-vertical',
            width:            20,
            height:           120,
            cursor:           'ns-resize',
            accentColor:      '#f9ab00',
          } as React.CSSProperties}
          onMouseDown={e => e.stopPropagation()}
        />
      </div>
      <span className="text-[9px] text-white/40" style={{ minWidth: 22, textAlign: 'center' }}>
        {label}
      </span>
    </div>
  )
}

// ── Horizontal labeled slider ─────────────────────────────────────────────────

function HSlider({ label, value, min, max, step = 0.01, onChange }: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold tracking-wider text-white/70 w-20 flex-shrink-0">
        {label}
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-1 cursor-pointer"
        style={{ accentColor: '#f9ab00' }}
        onMouseDown={e => e.stopPropagation()}
      />
    </div>
  )
}

// ── Toggle checkbox ───────────────────────────────────────────────────────────

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox" checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-amber-400 cursor-pointer"
        onMouseDown={e => e.stopPropagation()}
      />
      <span className="text-[10px] font-bold tracking-wider text-white/70">{label}</span>
    </label>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function EqualizerPanel() {
  const [eq, setEq] = useState<EqState>(() => audioEngine.getEq())

  const updateEq = useCallback(<K extends keyof EqState>(key: K, value: EqState[K]) => {
    setEq(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleBand = (index: number, gainDb: number) => {
    audioEngine.setBand(index, gainDb)
    updateEq('bands', eq.bands.map((v, i) => i === index ? gainDb : v))
    updateEq('preset', '')
  }

  const handlePreset = (name: string) => {
    audioEngine.applyPreset(name)
    const gains = EQ_PRESETS[name]
    setEq(prev => ({ ...prev, preset: name, bands: [...gains] }))
  }

  const handleMasterGain = (v: number) => {
    audioEngine.setMasterGain(v)
    updateEq('masterGain', v)
  }

  const handleSurround = (v: number) => {
    audioEngine.setSurround(v)
    updateEq('surround', v)
  }

  const handleDeepBass = (v: number) => {
    audioEngine.setDeepBass(v)
    updateEq('deepBass', v)
  }

  const handleBalance = (v: number) => {
    audioEngine.setBalance(v)
    updateEq('balance', v)
  }

  const handleAmplifier = (on: boolean) => {
    audioEngine.toggleAmplifier(on)
    updateEq('amplifier', on)
  }

  const handleCompressor = (on: boolean) => {
    audioEngine.toggleCompressor(on)
    updateEq('compressor', on)
  }

  const handleBypass = (on: boolean) => {
    audioEngine.setBypass(on)
    updateEq('bypass', on)
  }

  const handleReset = () => {
    audioEngine.reset()
    setEq({ ...DEFAULT_EQ })
  }

  return (
    <div
      className="flex flex-col h-full border-l border-white/10 overflow-y-auto overflow-x-hidden select-none"
      style={{ width: 280, background: '#1a1a1a', color: '#fff', fontSize: 12 }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-widest text-amber-400">ÉGALISEUR</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleReset}
            className="px-2 py-0.5 text-[9px] font-bold tracking-wider bg-white/10 hover:bg-white/20 rounded transition-colors"
            onMouseDown={e => e.stopPropagation()}
          >
            RESET
          </button>
          <button
            onClick={() => handleBypass(!eq.bypass)}
            className={`px-2 py-0.5 text-[9px] font-bold tracking-wider rounded transition-colors ${
              eq.bypass ? 'bg-amber-400 text-black' : 'bg-white/10 hover:bg-white/20'
            }`}
            onMouseDown={e => e.stopPropagation()}
          >
            BYP
          </button>
        </div>
      </div>

      {/* Sliders: surround, deep bass, balance */}
      <div className="px-3 py-2 space-y-2.5 border-b border-white/10">
        <HSlider label="SURROUND"  value={eq.surround}  min={0}  max={1}  onChange={handleSurround} />
        <HSlider label="DEEP BASS" value={eq.deepBass}  min={0}  max={1}  onChange={handleDeepBass} />
        <HSlider label="BALANCE"   value={eq.balance}   min={-1} max={1}  onChange={handleBalance} />
      </div>

      {/* Toggles */}
      <div className="px-3 py-2 flex items-center gap-4 border-b border-white/10">
        <Toggle label="AMPLIFIER"  checked={eq.amplifier}  onChange={handleAmplifier} />
        <Toggle label="COMPRESSOR" checked={eq.compressor} onChange={handleCompressor} />
      </div>

      {/* Gain slider */}
      <div className="px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-wider text-white/70 w-10 flex-shrink-0">GAIN</span>
          <input
            type="range" min={0} max={2} step={0.01} value={eq.masterGain}
            onChange={e => handleMasterGain(Number(e.target.value))}
            className="flex-1 h-1 cursor-pointer"
            style={{ accentColor: '#f9ab00' }}
            onMouseDown={e => e.stopPropagation()}
          />
          <span className="text-[10px] font-mono text-amber-400/80 w-8 text-right">
            {Math.round((eq.masterGain - 1) * 100) > 0
              ? `+${Math.round((eq.masterGain - 1) * 100)}`
              : Math.round((eq.masterGain - 1) * 100)}
          </span>
        </div>
      </div>

      {/* dB scale */}
      <div className="flex justify-end px-3 pt-2">
        <div className="flex flex-col justify-between text-[8px] font-mono text-white/30 mr-1" style={{ height: 120 }}>
          <span>+{MAX_DB}</span>
          <span>0</span>
          <span>{MIN_DB}</span>
        </div>
      </div>

      {/* 10-band EQ */}
      <div className="flex justify-between px-2 pb-1" style={{ gap: 2 }}>
        {eq.bands.map((v, i) => (
          <EqSlider
            key={i}
            value={v}
            label={BAND_LABELS[i]}
            onChange={db => handleBand(i, db)}
          />
        ))}
      </div>

      {/* Presets */}
      <div className="px-2 py-2 border-t border-white/10">
        <div className="flex flex-wrap gap-1">
          {PRESET_NAMES.map(name => (
            <button
              key={name}
              onClick={() => handlePreset(name)}
              className={`px-2 py-1 text-[9px] font-bold tracking-wider rounded transition-colors ${
                eq.preset === name
                  ? 'bg-amber-500 text-black'
                  : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/90'
              }`}
              onMouseDown={e => e.stopPropagation()}
            >
              {name.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
