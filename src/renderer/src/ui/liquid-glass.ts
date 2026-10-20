import { createUniqueId, onCleanup } from 'solid-js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The lens of a rounded rectangle as a displacement map (#149): R and G are how far, along x and
 * y, the backdrop under each pixel is sampled from; 128 is «right under it». Inside a band along
 * the rim (`bezel`) the backdrop is pulled inward, more the closer to the edge, as through the
 * thick edge of a glass lens; the middle stays put. Pixels, row by row, RGBA.
 */
export function lensMap(
  width: number,
  height: number,
  radius: number,
  bezel: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  const r = Math.min(radius, width / 2, height / 2)
  // Signed distance to the rim: negative inside.
  const sdf = (x: number, y: number): number => {
    const qx = Math.abs(x - width / 2) - (width / 2 - r)
    const qy = Math.abs(y - height / 2) - (height / 2 - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const depth = -sdf(x + 0.5, y + 0.5)
      let dx = 0
      let dy = 0
      if (depth > 0 && depth < bezel) {
        // Outward normal from the distance field.
        const nx = sdf(x + 1.5, y + 0.5) - sdf(x - 0.5, y + 0.5)
        const ny = sdf(x + 0.5, y + 1.5) - sdf(x + 0.5, y - 0.5)
        const length = Math.hypot(nx, ny) || 1
        const t = 1 - depth / bezel
        const strength = t * t * (3 - 2 * t)
        dx = (nx / length) * strength
        dy = (ny / length) * strength
      }
      const i = (y * width + x) * 4
      data[i] = 128 + dx * 127
      data[i + 1] = 128 + dy * 127
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return data
}

/** How strong the lens is for a surface this tall: the bezel and the displacement, in px. */
export function lensFor(height: number): { bezel: number; scale: number } {
  return {
    bezel: Math.max(6, Math.min(22, height * 0.3)),
    scale: Math.max(10, Math.min(42, height * 0.5)),
  }
}

/**
 * Makes an `.rt-glass--liquid` element liquid glass (#149): its own SVG lens, applied in
 * `backdrop-filter` through `--glass-lens` (Chromium applies SVG filters there), redrawn when its
 * size changes, and the highlight following the pointer. Use as a `ref`; it cleans up with the
 * component. Without a canvas (tests) the element stays clear frosted glass.
 */
export function liquidGlass(element: HTMLElement): void {
  const id = `glass-lens-${createUniqueId()}`
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  const filter = document.createElementNS(SVG_NS, 'filter')
  filter.id = id
  filter.setAttribute('filterUnits', 'userSpaceOnUse')
  filter.setAttribute('color-interpolation-filters', 'sRGB')
  filter.setAttribute('x', '0')
  filter.setAttribute('y', '0')
  const image = document.createElementNS(SVG_NS, 'feImage')
  image.setAttribute('result', 'lens')
  image.setAttribute('preserveAspectRatio', 'none')
  const displace = document.createElementNS(SVG_NS, 'feDisplacementMap')
  displace.setAttribute('in', 'SourceGraphic')
  displace.setAttribute('in2', 'lens')
  displace.setAttribute('xChannelSelector', 'R')
  displace.setAttribute('yChannelSelector', 'G')
  filter.append(image, displace)
  svg.append(filter)
  document.body.append(svg)

  const canvas = document.createElement('canvas')
  let drawn = ''
  const draw = (): void => {
    const width = Math.round(element.offsetWidth)
    const height = Math.round(element.offsetHeight)
    if (width === 0 || height === 0 || `${width}x${height}` === drawn) return
    const context = canvas.getContext('2d')
    if (!context) return
    drawn = `${width}x${height}`
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
    const { bezel, scale } = lensFor(height)
    canvas.width = width
    canvas.height = height
    const pixels = context.createImageData(width, height)
    pixels.data.set(lensMap(width, height, radius, bezel))
    context.putImageData(pixels, 0, 0)
    for (const node of [filter, image]) {
      node.setAttribute('width', String(width))
      node.setAttribute('height', String(height))
    }
    image.setAttribute('href', canvas.toDataURL())
    displace.setAttribute('scale', String(scale))
    element.style.setProperty('--glass-lens', `url(#${id})`)
  }

  let frame = 0
  const schedule = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(draw)
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  observer?.observe(element)
  schedule()

  const follow = (event: PointerEvent): void => {
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    element.style.setProperty('--glass-lx', `${((event.clientX - box.left) / box.width) * 100}%`)
    element.style.setProperty('--glass-ly', `${((event.clientY - box.top) / box.height) * 100}%`)
  }
  element.addEventListener('pointermove', follow)

  onCleanup(() => {
    cancelAnimationFrame(frame)
    observer?.disconnect()
    element.removeEventListener('pointermove', follow)
    svg.remove()
  })
}
