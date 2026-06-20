import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import IsoZoneBadge from '../../../components/ui/IsoZoneBadge.jsx'

function FloatingCard({ position, title, value, unit, warn, children }) {
  return (
    <Html position={position} center>
      <div style={{
        background: 'rgba(20, 20, 25, 0.85)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${warn ? 'var(--color-warning)' : 'var(--color-border-card)'}`,
        borderRadius: 6,
        padding: '6px 12px',
        color: 'var(--color-text-primary)',
        whiteSpace: 'nowrap',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        pointerEvents: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        minWidth: 100,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
          {title}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: warn ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
          {value != null ? `${Number(value).toFixed(2)} ${unit}` : '—'}
        </div>
        {children}
      </div>
    </Html>
  )
}

function SpinningCube({ rpm }) {
  const meshRef = useRef()

  useFrame((state, delta) => {
    // rpm is revs per minute. Convert to radians per second.
    const speed = rpm != null ? (rpm * Math.PI * 2) / 60 : 0
    if (meshRef.current) {
      meshRef.current.rotation.y += speed * delta
    }
  })

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#334155" wireframe={true} />
    </mesh>
  )
}

export default function Pump3DScene({ readings, activeFault }) {
  return (
    <div style={{ flex: 1, minHeight: 400, position: 'relative', background: 'var(--color-bg-surface)', borderRadius: 8, overflow: 'hidden' }}>
      <Canvas camera={{ position: [4, 3, 5], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        
        <OrbitControls makeDefault enablePan={false} minDistance={3} maxDistance={10} />
        
        <SpinningCube rpm={readings.rpm} />

        <group>
          {/* Top */}
          <FloatingCard position={[0, 1.8, 0]} title="Vibration Axial" value={readings.vibration_axial} unit="mm/s">
             <div style={{ marginTop: 2 }}><IsoZoneBadge mmPerS={readings.vibration_axial} /></div>
          </FloatingCard>
          
          {/* Left */}
          <FloatingCard position={[-2.2, 0, 0]} title="Vibration Radial" value={readings.vibration_radial} unit="mm/s" />
          
          {/* Right */}
          <FloatingCard position={[2.2, 0, 0]} title="Vibration Tang" value={readings.vibration_tangential} unit="mm/s" />
          
          {/* Front / Bottom */}
          <FloatingCard position={[0, -1.8, 1]} title="Temperature" value={readings.temperature} unit="°C" warn={readings.temperature > 80} />
          
          {/* Back */}
          <FloatingCard position={[0, -1.8, -1]} title="RPM" value={readings.rpm} unit="rpm" />
        </group>
      </Canvas>
      
      {/* Overlay Status */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 800 }}>LIVE 3D TELEMETRY</div>
        {readings.emission_hz && (
          <div style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--color-bg-card)', color: readings.emission_hz >= 10 ? 'var(--color-danger)' : 'var(--color-success)', border: '1px solid var(--color-border-card)', display: 'inline-block' }}>
            Emission: {readings.emission_hz} Hz
          </div>
        )}
        {activeFault && (
          <div style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--color-danger-tint)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)', display: 'inline-block' }}>
            Active Fault: {activeFault}
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 12, right: 12, fontSize: 10, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>
        Drag to rotate
      </div>
    </div>
  )
}
