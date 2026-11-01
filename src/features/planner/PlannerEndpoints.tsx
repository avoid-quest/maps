import { View } from 'react-native';
import { useThemeColors } from '../../theme';
import { IconButton, useHairlines } from '../../ui';
import { PressableSurface } from '../../ui/PressableSurface';
import { Text } from '../../ui/Text';
import { ORIGIN_LABELS, type PlannerEndpoint, type PlannerTask } from '../app/task-model';
import { usePlannerContext } from './usePlanner';

/** Origin and destination as two editable fields, with the swap between them. */
export function PlannerEndpoints({ task }: { task: PlannerTask }) {
  const planner = usePlannerContext();
  const hairlines = useHairlines();
  const origin = task.originStep === 'locating' ? 'Cerco la tua posizione…'
    : task.originStep === 'picking' ? 'Tocca la mappa per la partenza'
      : task.origin.ready ? task.origin.label : ORIGIN_LABELS.unset;
  const canSwap = task.origin.ready && task.originStep === 'idle';
  return (
    <View style={hairlines.box} className="flex-row items-center overflow-hidden rounded-2xl pr-1">
      <View className="min-w-0 flex-1">
        <EndpointField endpoint="origin" label="Da" value={origin} pending={!task.origin.ready || task.originStep !== 'idle'} onPress={() => planner.editEndpoint('origin')} />
        <View style={hairlines.top} className="ml-12" />
        <EndpointField endpoint="destination" label="A" value={task.destination.name} pending={false} onPress={() => planner.editEndpoint('destination')} />
      </View>
      <IconButton icon="swap-vertical" label="Inverti partenza e destinazione" disabled={!canSwap} onPress={planner.swapEndpoints} />
    </View>
  );
}

function EndpointField({ endpoint, label, value, pending, onPress }: { endpoint: PlannerEndpoint; label: string; value: string; pending: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const name = endpoint === 'origin' ? 'Partenza' : 'Destinazione';
  return (
    <PressableSurface rippleColor={`${colors.textPrimary}14`} contentClassName="min-h-14 flex-row items-center" accessibilityRole="button"
      accessibilityLabel={`${name}: ${value}. Cambia ${name.toLowerCase()}`} onPress={onPress}>
      <View className="w-12 items-center">
        {/* A ring for where the trip starts, a filled dot for where it ends (shape, not colour). */}
        <View style={endpoint === 'origin'
          ? { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.textPrimary }
          : { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.textPrimary }} />
      </View>
      <View className="min-w-0 flex-1 py-1">
        <Text className="text-xs text-secondary">{label}</Text>
        <Text numberOfLines={1} className={`text-base ${pending ? 'text-secondary' : 'font-medium text-primary'}`}>{value}</Text>
      </View>
    </PressableSurface>
  );
}
