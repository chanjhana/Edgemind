import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import IsoZoneBadge from '../../../components/ui/IsoZoneBadge.jsx'

function FloatingCard({ position, title, value, unit, warn, children }) {
  return (
    <Html position={position} center>
      <div style={{
        background: 'var(--color-bg-card)',
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

function IndustrialPump({ rpm, pumpId }) {
  const turbineRef = useRef()

  useFrame((state, delta) => {
    // rpm is revs per minute. Convert to radians per second.
    // If no RPM reading is available, default to 1500.
    const activeRpm = rpm != null ? rpm : 1500;
    // Scale down the visual RPM by a factor of 10 so it doesn't alias or strobe at 60fps
    const visualRpm = activeRpm / 10;
    const speed = (visualRpm * Math.PI * 2) / 60;
    if (turbineRef.current) {
      turbineRef.current.rotation.z -= speed * delta;
    }
  })

  const pumpColors = {
    pump1: '#3b82f6', // blue
    pump2: '#10b981', // green
    pump3: '#f59e0b', // orange
    pump4: '#8b5cf6', // purple
  };
  // Motor uses the pod color, volute is a large grey casing like in the image
  const motorColor = pumpColors[pumpId] || '#3b82f6';
  const voluteColor = '#475569'; // much darker grey
  const pipeColor = '#64748b'; // slightly lighter than volute
  const shaftColor = '#64748b';

  return (
    <group scale={0.55}>
      {/* 1. Motor Block (Back) */}
      <group position={[0, 0, -3.5]}>
        {/* Main motor cylinder */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[2.2, 2.2, 4, 32]} />
          <meshStandardMaterial color={motorColor} metalness={0.4} roughness={0.6} />
        </mesh>
        {/* Motor back cap */}
        <mesh position={[0, 0, -2]}>
          <sphereGeometry args={[2.2, 32, 16]} />
          <meshStandardMaterial color={motorColor} metalness={0.4} roughness={0.6} />
        </mesh>
        {/* Motor ribs (fins) */}
        {[...Array(12)].map((_, i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 6]}>
            <boxGeometry args={[4.8, 0.15, 3.6]} />
            <meshStandardMaterial color={motorColor} metalness={0.4} roughness={0.6} />
          </mesh>
        ))}
        {/* Base mount for motor */}
        <mesh position={[0, -2.4, 0]}>
          <boxGeometry args={[3, 0.4, 3]} />
          <meshStandardMaterial color={motorColor} />
        </mesh>
      </group>

      {/* 2. Drive Shaft & Couplings */}
      <group position={[0, 0, -1]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.4, 0.4, 2, 16]} />
          <meshStandardMaterial color={shaftColor} metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Couplings */}
        <mesh position={[0, 0, -0.7]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 0.4, 16]} />
          <meshStandardMaterial color={shaftColor} metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0, 0.7]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 0.4, 16]} />
          <meshStandardMaterial color={shaftColor} metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* 3. Volute / External Casing (Thicker to contain pipes) */}
      <group position={[0, 0, 1]}>
        {/* Main volute body */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[3.2, 3.2, 2.4, 32]} />
          <meshStandardMaterial color={voluteColor} metalness={0.2} roughness={0.5} />
        </mesh>
        {/* Volute edges */}
        <mesh position={[0, 0, -1.2]}>
          <torusGeometry args={[3.2, 0.2, 16, 32]} />
          <meshStandardMaterial color={voluteColor} metalness={0.2} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, 1.2]}>
          <torusGeometry args={[3.2, 0.2, 16, 32]} />
          <meshStandardMaterial color={voluteColor} metalness={0.2} roughness={0.5} />
        </mesh>
        {/* Base mount for volute */}
        <mesh position={[0, -3.4, 0]}>
          <boxGeometry args={[3, 0.4, 2.6]} />
          <meshStandardMaterial color={voluteColor} />
        </mesh>

        {/* 4. Inlet & Outlet Pipes (Narrower) */}
        {/* Outlet Pipe (Top) */}
        <mesh position={[0, 3.1, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 3, 16]} />
          <meshStandardMaterial color={pipeColor} metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, 4.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.95, 0.15, 16, 32]} />
          <meshStandardMaterial color="#334155" />
        </mesh>

        {/* Inlet Pipe (Left side) */}
        <mesh position={[-3.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.8, 0.8, 3, 16]} />
          <meshStandardMaterial color={pipeColor} metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[-4.6, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.95, 0.15, 16, 32]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      </group>

      {/* 5. Protruding Spinning Turbine */}
      {/* 5. Protruding Spinning Turbine */}
      {/* Positioned outside the volute face to be fully visible and clear of the casing */}
      <group position={[0, 0, 2.8]} ref={turbineRef}>
        {/* Connecting Rod (protruding out of the pump) */}
        <mesh position={[0, 0, -0.9]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 1.8, 16]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.2} />
        </mesh>
        
        {/* Hub */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 1.2, 16]} />
          <meshStandardMaterial color="#eab308" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Hub cap */}
        <mesh position={[0, 0, 0.6]}>
          <sphereGeometry args={[0.6, 16, 16]} />
          <meshStandardMaterial color="#eab308" metalness={0.8} roughness={0.2} />
        </mesh>
        
        {/* Blades (Protruding and visible) */}
        {[...Array(6)].map((_, i) => {
          const angle = (i * Math.PI * 2) / 6;
          return (
            <group key={i} rotation={[0, 0, angle]}>
              <mesh position={[1.2, 0, 0]} rotation={[0, 0.4, 0]}>
                <boxGeometry args={[2.0, 0.1, 0.4]} />
                <meshStandardMaterial color="#facc15" metalness={0.7} roughness={0.3} />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  )
}

export default function Pump3DScene({ readings, activeFault, pumpId }) {
  return (
    <div style={{ height: 400, position: 'relative', background: 'var(--color-bg-surface)', borderRadius: 8, overflow: 'hidden' }}>
      <Canvas camera={{ position: [5, 4, 6], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        
        <OrbitControls makeDefault enablePan={false} minDistance={3} maxDistance={12} />
        
        <IndustrialPump rpm={readings.rpm} pumpId={pumpId} />

        <group>
          {/* Motor Back - Vibration Axial (Shifted left) */}
          <FloatingCard position={[-2.0, 1.5, -2.5]} title="Vibration Axial" value={readings.vibration_axial} unit="mm/s">
             <div style={{ marginTop: 2 }}><IsoZoneBadge mmPerS={readings.vibration_axial} /></div>
          </FloatingCard>
          
          {/* Motor Top - Vibration Radial (Shifted right) */}
          <FloatingCard position={[2.0, 1.5, -1.0]} title="Vibration Radial" value={readings.vibration_radial} unit="mm/s" />
          
          {/* Volute Top - Vibration Tangential */}
          <FloatingCard position={[0, 3.2, 0.5]} title="Vibration Tang" value={readings.vibration_tangential} unit="mm/s" />
          
          {/* Volute Side/Bottom - Temperature */}
          <FloatingCard position={[1.8, -1.2, 0.5]} title="Temperature" value={readings.temperature} unit="°C" warn={readings.temperature > 80} />
          
          {/* Turbine Side - RPM */}
          <FloatingCard position={[1.5, 0.5, 2.0]} title="RPM" value={readings.rpm} unit="rpm" />
        </group>
      </Canvas>
      
      {/* Overlay Status */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
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
