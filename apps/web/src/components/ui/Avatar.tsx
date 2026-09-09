import { USER_COLOURS } from '@platform/types'

interface Props {
  initials: string
  colourKey: keyof typeof USER_COLOURS
  size?: 'sm' | 'md' | 'lg'
}

const SIZE = { sm: 'w-6 h-6 text-xs', md: 'w-8 h-8 text-xs', lg: 'w-9 h-9 text-sm' }

export function Avatar({ initials, colourKey, size = 'md' }: Props) {
  const { bg, text } = USER_COLOURS[colourKey] ?? USER_COLOURS.MW
  return (
    <div
      className={`${SIZE[size]} flex items-center justify-center rounded-full font-mono font-bold flex-none`}
      style={{ backgroundColor: bg, color: text }}
    >
      {initials}
    </div>
  )
}
