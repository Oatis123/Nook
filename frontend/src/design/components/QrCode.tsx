import { useEffect, useState } from 'react'
import { useResolvedTheme } from '@/lib/theme'

/** The QR keeps a light plate so it stays scannable; only its ink follows the theme. */
const QR_COLORS = {
  light: { dark: '#1A1A15', light: '#FBF9F3' },
  dark: { dark: '#0F100C', light: '#EEECE0' },
  cyber: { dark: '#0A0912', light: '#EDEBFA' },
} as const

export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const theme = useResolvedTheme()

  useEffect(() => {
    let cancelled = false
    // Loaded on demand: only the Telegram linking and login screens draw a QR code.
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(value, {
          width: size,
          margin: 1,
          color: QR_COLORS[theme],
        }),
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [value, size, theme])

  if (!dataUrl) {
    return (
      <div
        className="animate-pulse bg-surface"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    )
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="QR code"
      className="rounded-sm border border-border"
    />
  )
}
