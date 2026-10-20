import { createUniqueId, onCleanup } from 'solid-js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Glass bends light by this refractive index (crown glass). */
const REFRACTIVE_INDEX = 1.5
/** The rim light comes from the top left (WWDC25 «Meet Liquid Glass»). */
export const DEFAULT_LIGHT = -0.75 * Math.PI

/**
 * The height of the glass across its bezel (#149): 0 at the outer edge, 1 where the flat middle
 * begins — a squircle, so the curve flows into the middle without a visible ridge (kube.io,
 * «Liquid Glass in the browser»).
 */
export function glassHeight(x: number): number {
  return Math.pow(1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 4), 0.25)
}

/**
 * How far a ray falling straight onto the glass lands from where it would without it, across
 * the bezel (Snell's law, one refraction), normalised to the largest; `max` is that largest, in
 * units of the bezel width. Index i is the point i/samples into the bezel.
 */
export function refraction(samples = 128): { magnitudes: number[]; max: number } {
  const thickness = 1.2
  const raw: number[] = []
  for (let i = 0; i < samples; i++) {
    const x = (i + 0.5) / samples
    const delta = 0.001
    const slope = ((glassHeight(x + delta) - glassHeight(x - delta)) / (2 * delta)) * thickness
    const incidence = Math.atan(slope)
    const refracted = Math.asin(Math.sin(incidence) / REFRACTIVE_INDEX)
    raw.push(Math.tan(incidence - refracted) * thickness * (glassHeight(x) + 0.1))
  }
  const max = Math.max(...raw)
  return { magnitudes: raw.map((m) => m / max), max }
}

/** Per pixel of a rounded rectangle: depth inside its rim and the outward normal there. */
export interface GlassShape {
  width: number
  height: number
  bezel: number
  /** Distance from the rim inward, in pixels; ≤ 0 outside the shape. */
  depth: Float32Array
  normalX: Float32Array
  normalY: Float32Array
}

export function glassShape(
  width: number,
  height: number,
  radius: number,
  bezel: number,
): GlassShape {
  const r = Math.min(radius, width / 2, height / 2)
  const sdf = (x: number, y: number): number => {
    const qx = Math.abs(x - width / 2) - (width / 2 - r)
    const qy = Math.abs(y - height / 2) - (height / 2 - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  const size = width * height
  const depth = new Float32Array(size)
  const normalX = new Float32Array(size)
  const normalY = new Float32Array(size)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const d = -sdf(x + 0.5, y + 0.5)
      depth[i] = d
      if (d > 0 && d < bezel) {
        const nx = sdf(x + 1.5, y + 0.5) - sdf(x - 0.5, y + 0.5)
        const ny = sdf(x + 0.5, y + 1.5) - sdf(x + 0.5, y - 0.5)
        const length = Math.hypot(nx, ny) || 1
        normalX[i] = nx / length
        normalY[i] = ny / length
      }
    }
  }
  return { width, height, bezel, depth, normalX, normalY }
}

/**
 * The displacement map of the lens, RGBA: the backdrop under the rim is sampled from further
 * in, as through the thick edge of a lens; the flat middle stays put. R/G 128 = no shift.
 */
export function displacementMap(shape: GlassShape): Uint8ClampedArray {
  const { magnitudes } = refraction()
  const data = new Uint8ClampedArray(shape.width * shape.height * 4)
  for (let i = 0; i < shape.depth.length; i++) {
    const d = shape.depth[i] ?? 0
    let dx = 0
    let dy = 0
    if (d > 0 && d < shape.bezel) {
      const at = Math.min(magnitudes.length - 1, Math.floor((d / shape.bezel) * magnitudes.length))
      const m = magnitudes[at] ?? 0
      dx = -(shape.normalX[i] ?? 0) * m
      dy = -(shape.normalY[i] ?? 0) * m
    }
    data[i * 4] = 128 + dx * 127
    data[i * 4 + 1] = 128 + dy * 127
    data[i * 4 + 2] = 128
    data[i * 4 + 3] = 255
  }
  return data
}

/**
 * The light on the glass, RGBA (white with alpha): a thin bright line along the rim where it
 * faces the light, a weaker bounce on the opposite side, a faint glow inside the bezel. The
 * light lives on the edge and defines the silhouette; the face of the glass stays clear.
 */
export function specularMap(
  shape: GlassShape,
  light: number,
  pixelRatio: number,
  gain = 1,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(shape.width * shape.height * 4)
  const lx = Math.cos(light)
  const ly = Math.sin(light)
  const line = 2.2 * pixelRatio
  for (let i = 0; i < shape.depth.length; i++) {
    const d = shape.depth[i] ?? 0
    let alpha = 0
    if (d > 0 && d < shape.bezel) {
      const facing = (shape.normalX[i] ?? 0) * lx + (shape.normalY[i] ?? 0) * ly
      const rim = Math.max(0, 1 - d / line) * 0.85 + Math.pow(1 - d / shape.bezel, 4) * 0.18
      const lit = Math.pow(Math.max(0, facing), 1.5) + Math.pow(Math.max(0, -facing), 1.5) * 0.4
      alpha = rim * lit * gain
    }
    data[i * 4] = 255
    data[i * 4 + 1] = 255
    data[i * 4 + 2] = 255
    data[i * 4 + 3] = Math.round(Math.min(1, alpha) * 255)
  }
  return data
}

/**
 * The bezel for a surface, in CSS px: within its corner radius and a third of its height, at
 * most 26 — enough to bend the edge, while the middle under the controls stays flat.
 */
export function bezelFor(height: number, radius: number): number {
  return Math.max(4, Math.min(radius, height * 0.32, 26))
}

/** No motion wanted: the lens is there at once instead of materialising. */
function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Makes an `.rt-glass--liquid` element liquid glass (#149), the way Apple describes it: the
 * backdrop bends at the rim (a lens from Snell's law over a squircle bezel), the light lives on
 * the rim and travels round it towards the pointer, a press lights the control from under the
 * pointer and energises the glass, and the glass materialises by its lensing growing in. All of
 * it in one SVG filter in `backdrop-filter` (`--glass-lens`; Chromium applies SVG filters there),
 * with the maps drawn at the screen's pixel ratio. Use as a `ref`; it cleans up with the
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
  const add = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string>,
  ): SVGElementTagNameMap[K] => {
    const primitive = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attributes)) primitive.setAttribute(name, value)
    filter.append(primitive)
    return primitive
  }
  // A little frost first, so text under the glass does not fight with the labels on it.
  add('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '3', result: 'frost' })
  const lensImage = add('feImage', { result: 'lens', preserveAspectRatio: 'none' })
  const displace = add('feDisplacementMap', {
    in: 'frost',
    in2: 'lens',
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'bent',
  })
  add('feColorMatrix', { in: 'bent', type: 'saturate', values: '1.3', result: 'vivid' })
  const lightImage = add('feImage', { result: 'light', preserveAspectRatio: 'none' })
  add('feBlend', { in: 'light', in2: 'vivid', mode: 'screen' })
  svg.append(filter)
  document.body.append(svg)

  const canvas = document.createElement('canvas')
  const toUrl = (data: Uint8ClampedArray, width: number, height: number): string | null => {
    const context = canvas.getContext('2d')
    if (!context) return null
    canvas.width = width
    canvas.height = height
    const pixels = context.createImageData(width, height)
    pixels.data.set(data)
    context.putImageData(pixels, 0, 0)
    return canvas.toDataURL()
  }

  let shape: GlassShape | null = null
  let ratio = 1
  let scale = 0
  let light = DEFAULT_LIGHT
  let drawn = ''
  const paintLight = (gain = 1): void => {
    if (!shape) return
    const url = toUrl(specularMap(shape, light, ratio, gain), shape.width, shape.height)
    if (url) lightImage.setAttribute('href', url)
  }

  // Materialising: the lensing grows in instead of a plain fade.
  let grow = 0
  const materialise = (): void => {
    if (reducedMotion()) {
      displace.setAttribute('scale', String(scale))
      return
    }
    const start = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 260)
      displace.setAttribute('scale', String(scale * (1 - Math.pow(1 - t, 3))))
      if (t < 1) grow = requestAnimationFrame(step)
    }
    displace.setAttribute('scale', '0')
    grow = requestAnimationFrame(step)
  }

  const draw = (): void => {
    const width = Math.round(element.offsetWidth)
    const height = Math.round(element.offsetHeight)
    ratio = window.devicePixelRatio || 1
    const key = `${width}x${height}@${ratio}`
    if (width === 0 || height === 0 || key === drawn || !canvas.getContext('2d')) return
    const first = drawn === ''
    drawn = key
    const radius = Math.min(
      parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
      width / 2,
      height / 2,
    )
    const bezel = bezelFor(height, radius)
    shape = glassShape(
      Math.round(width * ratio),
      Math.round(height * ratio),
      radius * ratio,
      bezel * ratio,
    )
    const lens = toUrl(displacementMap(shape), shape.width, shape.height)
    if (!lens) return
    for (const target of [filter, lensImage, lightImage]) {
      target.setAttribute('width', String(width))
      target.setAttribute('height', String(height))
    }
    lensImage.setAttribute('href', lens)
    paintLight()
    scale = refraction().max * bezel
    element.style.setProperty('--glass-lens', `url(#${id})`)
    element.dataset['lens'] = ''
    if (first) materialise()
    else displace.setAttribute('scale', String(scale))
  }

  let frame = 0
  const schedule = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(draw)
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  observer?.observe(element)
  schedule()

  // The light travels round the rim towards the pointer, in steps, a few times a second at most.
  let lastLight = 0
  const follow = (event: PointerEvent): void => {
    const box = element.getBoundingClientRect()
    if (!shape || box.width === 0) return
    const angle = Math.atan2(
      event.clientY - (box.top + box.height / 2),
      event.clientX - (box.left + box.width / 2),
    )
    const now = performance.now()
    const turn = Math.abs(Math.atan2(Math.sin(angle - light), Math.cos(angle - light)))
    if (turn < 0.15 || now - lastLight < 70) return
    lastLight = now
    light = angle
    paintLight()
  }
  const rest = (): void => {
    light = DEFAULT_LIGHT
    paintLight()
  }

  // A press: the control lights up from under the pointer, and the glass flexes with light.
  let energised: ReturnType<typeof setTimeout> | undefined
  const press = (event: PointerEvent): void => {
    const control =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.rt-glass-control')
        : null
    if (control) {
      const box = control.getBoundingClientRect()
      control.style.setProperty('--press-x', `${event.clientX - box.left}px`)
      control.style.setProperty('--press-y', `${event.clientY - box.top}px`)
      // Restart the glow: reading the layout between the two applies the removal first.
      control.removeAttribute('data-pressed')
      control.getBoundingClientRect()
      control.setAttribute('data-pressed', '')
    }
    paintLight(1.8)
    element.setAttribute('data-energised', '')
    clearTimeout(energised)
    energised = setTimeout(() => {
      element.removeAttribute('data-energised')
      paintLight()
    }, 260)
  }
  element.addEventListener('pointermove', follow)
  element.addEventListener('pointerleave', rest)
  element.addEventListener('pointerdown', press)

  onCleanup(() => {
    cancelAnimationFrame(frame)
    cancelAnimationFrame(grow)
    clearTimeout(energised)
    observer?.disconnect()
    element.removeEventListener('pointermove', follow)
    element.removeEventListener('pointerleave', rest)
    element.removeEventListener('pointerdown', press)
    svg.remove()
  })
}
