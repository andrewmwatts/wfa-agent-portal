// Class strings for dialogs that turn into full-screen sheets below 640px (sm) and stay
// centred dialogs from sm up. Compose them so every dialog behaves the same way:
//
//   <div className={SHEET_OVERLAY} onClick={…}>
//     <div className={`${SHEET_PANEL} bg-gray-50 dark:bg-secondary sm:max-w-2xl sm:max-h-[88vh]`}>
//       <div className={`… ${SHEET_HEAD_PAD}`}>header</div>
//       <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">body</div>
//       <div className={`… ${SHEET_FOOT_PAD}`}>footer</div>
//
// `!mt-0` keeps the fixed overlay at the viewport edge when its parent is a `space-y-*`
// container (the sibling margin would otherwise push it down).

export const SHEET_OVERLAY =
  'fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 bg-black/60 sm:backdrop-blur-sm !mt-0'

export const SHEET_PANEL =
  'flex flex-col w-full max-sm:h-dvh sm:rounded-2xl sm:border border-gray-200 dark:border-white/15 shadow-2xl overflow-hidden'

// Clears the status bar / notch (header) and the home indicator (footer) on phones.
export const SHEET_HEAD_PAD = 'max-sm:pt-[max(0.75rem,env(safe-area-inset-top))]'
export const SHEET_FOOT_PAD = 'max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]'
