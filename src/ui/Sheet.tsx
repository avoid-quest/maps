import BottomSheet, { BottomSheetFlatList, BottomSheetFooter, BottomSheetScrollView, type BottomSheetFooterProps } from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { View, type AccessibilityActionEvent } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { SHEET_SNAP_LABELS, SHEET_SNAPS, type SheetHeights, type SheetSnap } from "./sheet-snaps";

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
  const index = SHEET_SNAPS.indexOf(snap);
  const current = useRef(index);
  const snapPoints = useMemo(() => [heights.peek, heights.half, heights.full], [heights.peek, heights.half, heights.full]);
  const latest = useRef(onSnapChange); latest.current = onSnapChange;
  useEffect(() => {
    if (current.current === index) return;
    current.current = index;
    sheet.current?.snapToIndex(index);
  }, [index]);
  const report = useCallback((next: number) => {
    const target = SHEET_SNAPS[next];
    if (!target || current.current === next) return;
    current.current = next;
    latest.current(target);
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    const next = SHEET_SNAPS[Math.min(SHEET_SNAPS.length - 1, Math.max(0, current.current + direction))];
    if (next) latest.current(next);
  }, []);
  const Handle = useCallback(() => (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Altezza della scheda"
      accessibilityValue={{ text: SHEET_SNAP_LABELS[snap] }}
      accessibilityActions={[{ name: "increment", label: "Espandi" }, { name: "decrement", label: "Riduci" }]}
      onAccessibilityAction={(event: AccessibilityActionEvent) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
      className="h-5 items-center justify-center"
    >
      <View style={{ backgroundColor: colors.textSecondary }} className="h-1 w-9 rounded-full opacity-60" />
    </View>
  ), [colors.textSecondary, step, snap]);
  const Footer = useCallback((props: BottomSheetFooterProps) => (
    <BottomSheetFooter {...props}><View style={{ height: footerHeight }} className="bg-surface">{footer}</View></BottomSheetFooter>
  ), [footer, footerHeight]);
  return (
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
      backgroundStyle={{ backgroundColor: colors.surface, borderColor: colors.divider, borderWidth: 1, borderRadius: 20 }}
      handleComponent={Handle}
      footerComponent={footer ? Footer : undefined}
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
        <View className="border-b border-divider" />
        {children}
      </View>
    </BottomSheet>
  );
}

/** Scrolling content that cooperates with sheet dragging. */
export function SheetScrollView({ children }: { children: ReactNode }) {
  return <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>{children}</BottomSheetScrollView>;
}

/** A virtualized list inside the sheet; use for results, stops and saved items. */
export const SheetFlatList = BottomSheetFlatList;
