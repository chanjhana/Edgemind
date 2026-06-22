import { useDispatch, useAppState } from '../../core/store/AppContext.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'
import { useFaultInjection } from '../../core/api/useFaultInjection.js'
import { SCENARIOS } from '../../core/constants/faultModes.js'
import ScenarioCard from './ScenarioCard.jsx'

async function _setLeak(enabled) {
  try {
    await fetch('/featureextractor/leak', { method: enabled ? 'POST' : 'DELETE' })
  } catch {
    // feature-extractor not port-forwarded; skip
  }
}

async function _setFill(enabled) {
  try {
    await fetch('/alertmanager/fill', { method: enabled ? 'POST' : 'DELETE' })
  } catch {
    // alert-manager not reachable; skip
  }
}

export default function ScenarioLauncher() {
  const { demoLab } = useAppState()
  const dispatch = useDispatch()

  const pump1 = useFaultInjection('pump1')
  const pump2 = useFaultInjection('pump2')
  const pump3 = useFaultInjection('pump3')
  const injectors = { pump1, pump2, pump3 }

  const anyActiveFault = Object.values(demoLab.activeFaults || {}).some(Boolean)

  async function handleLaunch(scenario) {
    // Inject physical fault if this scenario targets a pump
    if (scenario.faultMode && scenario.targetPump) {
      const inj = injectors[scenario.targetPump]
      if (inj) await inj.inject(scenario.faultMode)
    }
    // Enable memory leak for scenario 2
    if (scenario.id === 2) {
      await _setLeak(true)
    }
    // Start PVC fill for scenario 3 (self-cleaning on the backend)
    if (scenario.id === 3) {
      await _setFill(true)
    }
    dispatch({ type: 'SET_DEMO_SCENARIO', payload: {
      activeScenarioId: scenario.id,
      completedScenarioId: null,
      scenarioStartedAt: new Date().toISOString(),
    }})
  }

  async function handleClear(scenario) {
    // Clear physical fault
    if (scenario.targetPump) {
      const inj = injectors[scenario.targetPump]
      if (inj) await inj.clear()
    }
    // Disable memory leak
    if (scenario.id === 2) {
      await _setLeak(false)
    }
    // Stop PVC fill + clean up
    if (scenario.id === 3) {
      await _setFill(false)
    }
    dispatch({ type: 'SET_DEMO_SCENARIO', payload: {
      activeScenarioId: null,
      completedScenarioId: scenario.id,
    }})
  }

  return (
    <div>
      <PanelHeader title="Scenarios" style={{ marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {SCENARIOS.map(scenario => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            running={demoLab.activeScenarioId === scenario.id}
            completed={demoLab.completedScenarioId === scenario.id}
            disabled={anyActiveFault && demoLab.activeScenarioId !== scenario.id}
            onLaunch={() => handleLaunch(scenario)}
            onClear={() => handleClear(scenario)}
          />
        ))}
      </div>
    </div>
  )
}
