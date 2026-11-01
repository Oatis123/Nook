import { useEffect, useState } from 'react'

export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Loaded on demand: only the Telegram linking and login screens draw a QR code.
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(value, {
          width: size,
          margin: 1,
          color: { dark: '#080806', light: '#eceae2' },
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
  }, [value, size])

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
    <img src={dataUrl} width={size} height={size} alt="QR code" className="border border-border" />
  )
}
