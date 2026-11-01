import BottomSheet, { BottomSheetFlatList, BottomSheetFooter, BottomSheetScrollView, type BottomSheetFooterProps } from "@gorhom/bottom-sheet";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { StyleSheet, View, type AccessibilityActionEvent } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { Divider } from "./Divider";
import { distinctSnap, logicalSnapAt, physicalIndex, physicalSnaps, SHEET_SNAP_LABELS, type SheetHeights, type SheetSnap } from "./sheet-snaps";

/**
 * The app's one sheet interface. Features describe content and a snap; the gesture library stays
 * behind this file (currently @gorhom/bottom-sheet v5 on Reanimated 4 and Gesture Handler 2).
 * Heights are fixed per task and window so asynchronous content never moves the sheet; drag, the
 * header control, the adjustable handle and Android Back all move between the same three snaps.
 */
export function AppSheet({ snap, heights, onSnapChange, header, footer, footerHeight = 0, children, testID, bottomInset = 8, horizontalInset = 12 }: {
  snap: SheetSnap;
  heights: SheetHeights;
  /** Reports a snap the sheet is moving to (gesture or programmatic), as soon as the move starts. */
  onSnapChange: (snap: SheetSnap) => void;
  header: ReactNode;
  /** Pinned below scrolling content, such as route actions; reserve `footerHeight` for it. */
  footer?: ReactNode;
  footerHeight?: number;
  children: ReactNode;
  testID?: string;
  bottomInset?: number;
  horizontalInset?: number;
}) {
  const colors = useThemeColors();
  const sheet = useRef<BottomSheet>(null);
  // Gorhom resolves positions with indexOf, so it gets unique physical heights; logical snaps map onto them.
  const { peek, half, full } = heights;
  const snapPoints = useMemo(() => physicalSnaps({ peek, half, full }), [peek, half, full]);
  const index = physicalIndex(heights, snap);
  const current = useRef(index);
  const latest = useRef({ onSnapChange, snap, heights }); latest.current = { onSnapChange, snap, heights };
  useEffect(() => {
    if (current.current === index) return;
    current.current = index;
    sheet.current?.snapToIndex(index);
  }, [index, snapPoints]);
  const report = useCallback((next: number) => {
    if (next < 0 || current.current === next) return;
    current.current = next;
    const { onSnapChange: change, snap: logical, heights: sizes } = latest.current;
    const target = logicalSnapAt(sizes, next, logical);
    if (target !== logical) change(target);
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    const { onSnapChange: change, snap: logical, heights: sizes } = latest.current;
    const target = distinctSnap(sizes, logical, direction);
    if (target !== logical) change(target);
  }, []);
  const chrome = useMemo(() => ({ snap, step, footer, footerHeight, handleColor: colors.textSecondary, surface: colors.surface }), [snap, step, footer, footerHeight, colors.textSecondary, colors.surface]);
  return (
    <SheetChromeContext.Provider value={chrome}>
    <BottomSheet
      ref={sheet}
      index={index}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      animateOnMount
      detached
      bottomInset={bottomInset}
      style={{ marginHorizontal: horizontalInset }}
      backgroundStyle={{ backgroundColor: colors.surface, borderColor: colors.divider, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 }}
      handleComponent={SheetHandle}
      footerComponent={footer ? SheetFooter : undefined}
      onAnimate={(_from, to) => report(to)}
      onChange={report}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      // The library's default makes the whole sheet one adjustable element, hiding its content from
      // TalkBack. Content stays individually reachable; the handle is the adjustable control.
      accessible={false}
      accessibilityLabel=""
      accessibilityRole="none"
    >
      <View testID={testID} style={{ flex: 1, paddingBottom: footerHeight }}>
        {header}
        <Divider />
        {children}
      </View>
    </BottomSheet>
    </SheetChromeContext.Provider>
  );
}

/**
 * The handle and footer are rendered by the gesture library from component types. Their types stay
 * stable (module-level) and read changing values through context, so a snap change or a parent
 * re-render updates them in place instead of remounting: TalkBack keeps focus on the adjustable
 * handle, and a tap on the route actions is not lost to a remount.
 */
const SheetChromeContext = createContext<{ snap: SheetSnap; step: (direction: 1 | -1) => void; footer?: ReactNode; footerHeight: number; handleColor: string; surface: string }>({
  snap: "peek", step: () => undefined, footerHeight: 0, handleColor: "transparent", surface: "transparent",
});

function SheetHandle() {
  const { snap, step, handleColor } = useContext(SheetChromeContext);
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Altezza della scheda"
      accessibilityValue={{ text: SHEET_SNAP_LABELS[snap] }}
      accessibilityActions={[{ name: "increment", label: "Espandi" }, { name: "decrement", label: "Riduci" }]}
      onAccessibilityAction={(event: AccessibilityActionEvent) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
      className="h-5 items-center justify-center"
    >
      <View style={{ backgroundColor: handleColor }} className="h-1 w-9 rounded-full opacity-60" />
    </View>
  );
}

function SheetFooter(props: BottomSheetFooterProps) {
  const { footer, footerHeight, surface } = useContext(SheetChromeContext);
  return <BottomSheetFooter {...props}><View style={{ height: footerHeight, backgroundColor: surface }}>{footer}</View></BottomSheetFooter>;
}

/** Scrolling content that cooperates with sheet dragging. */
export function SheetScrollView({ children }: { children: ReactNode }) {
  return <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>{children}</BottomSheetScrollView>;
}

/** A virtualized list inside the sheet; use for results, stops and saved items. Taps work with the keyboard open. */
export const SheetFlatList = ((props: Parameters<typeof BottomSheetFlatList>[0]) => <BottomSheetFlatList keyboardShouldPersistTaps="handled" {...props} />) as typeof BottomSheetFlatList;
