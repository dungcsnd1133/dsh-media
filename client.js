window.__ModuleLoader__.load({
  id: 'dsh-media',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const FILE = /\/(?:media|clip|play)\/(?:watch\/)?([a-f0-9]{16}\.(?:mp3|mp4|jpe?g|png|webp))$/
    const ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 1.8v7.6M5 7.2 8 10.2l3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.2h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'

    function downloadUrl(src) {
      let url
      try { url = new URL(src, location.href) } catch { return null }
      if (url.searchParams.get('download') === '1') return null
      const match = FILE.exec(url.pathname)
      if (!match) return null
      return { href: `/media/${match[1]}?download=1`, name: match[1] }
    }

    function hasButton(name) {
      const value = window.CSS && CSS.escape ? CSS.escape(name) : name
      return !!document.querySelector(`a.dsh-media-dl[download="${value}"]`)
    }

    function filesBefore(tail) {
      const item = tail.closest('[data-chat-turn]')
      if (!item) return []
      const turn = item.getAttribute('data-chat-turn')
      const found = []
      const seen = new Set()
      let el = item.previousElementSibling
      while (el && el.getAttribute('data-chat-turn') === turn) {
        el.querySelectorAll('img,video,audio,a').forEach((node) => {
          const src = node.currentSrc || node.getAttribute('src') || node.getAttribute('href')
          const file = src && downloadUrl(src)
          if (!file || seen.has(file.name)) return
          seen.add(file.name)
          found.push(file)
        })
        el = el.previousElementSibling
      }
      return found.reverse()
    }

    function button(file) {
      const link = document.createElement('a')
      link.href = file.href
      link.download = file.name
      link.innerHTML = ICON
      link.setAttribute('aria-label', 'Tải về')
      link.dataset.dshMediaDl = '1'
      link.className = 'dsh-media-dl'
      return link
    }

    function shown(name) {
      return !!document.querySelector(`[data-dsh-player="${name}"]`)
    }

    function embed() {
      document.querySelectorAll('a[href]').forEach((anchor) => {
        if (anchor.classList.contains('dsh-media-dl') || anchor.closest('[data-clock]')) return
        const file = downloadUrl(anchor.href)
        if (!file) return
        if (shown(file.name)) {
          anchor.remove()
          return
        }
        const kind = file.name.endsWith('.mp4') ? 'video' : file.name.endsWith('.mp3') ? 'audio' : 'img'
        const player = document.createElement(kind)
        player.src = `/media/${file.name}`
        player.dataset.dshPlayer = file.name
        player.className = 'dsh-media-player'
        if (kind === 'img') player.alt = ''
        else {
          player.controls = true
          player.preload = 'metadata'
          if (kind === 'video') player.playsInline = true
        }
        anchor.replaceWith(player)
      })
    }

    function scan() {
      embed()
      document.querySelectorAll('a.dsh-media-dl').forEach((node) => {
        if (!node.closest('[data-clock]')) node.remove()
      })
      document.querySelectorAll('[data-turn-tail]').forEach((tail) => {
        const row = tail.querySelector('[data-clock]')
        if (!row) return
        let after = row.querySelector('button')
        for (const file of filesBefore(tail)) {
          if (hasButton(file.name)) continue
          const link = button(file)
          if (after) {
            after.insertAdjacentElement('afterend', link)
            after = link
          } else {
            row.append(link)
            after = link
          }
        }
      })
    }

    function DownloadButtons() {
      React.useEffect(() => {
        let scheduled = false
        const kick = () => {
          if (scheduled) return
          scheduled = true
          requestAnimationFrame(() => {
            scheduled = false
            scan()
          })
        }
        kick()
        const observer = new MutationObserver(kick)
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] })
        return () => observer.disconnect()
      }, [])
      return h('style', { 'data-dsh-media-dl': '' },
        'audio.dsh-media-player,video.dsh-media-player,img.dsh-media-player{display:block;width:100%;max-width:100%;margin:8px 0}audio.dsh-media-player{height:40px}video.dsh-media-player{background:#111;max-height:70vh;border-radius:12px}img.dsh-media-player{height:auto;border-radius:12px}.dsh-media-dl{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));margin:0;padding:6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent !important;box-shadow:none;color:var(--dsw-alias-label-tertiary,#8e8e93) !important;cursor:pointer;text-decoration:none !important;display:inline-flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}.dsh-media-dl svg{display:block;width:15px;height:15px}.dsh-media-dl:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)) !important;color:var(--dsw-alias-label-secondary,#636366) !important}')
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-media-download',
          order: 80,
        }, DownloadButtons))
      },
    }
  },
})
