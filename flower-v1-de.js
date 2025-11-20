/**
 * @name 野花🌷
 * @version 1
 */
;(() => {
  let {
      EVENT_NAMES: O,
      request: w,
      on: g,
      send: h,
      env: E,
      version: C,
      currentScriptInfo: U,
      utils: T,
    } = globalThis.lx,
    z = (c, N) => {
      switch (c) {
        case 'tx':
        case 'wy':
        case 'kw':
          return N.songmid
        case 'kg':
          return N.hash
        case 'mg':
          return N.copyrightId
      }
      throw Error('failed')
    },
    P = {
      'User-Agent': 'lx-music/' + E,
      ver: C,
      'source-ver': U.version,
    }
    // 实现on
  g(O.request, ({ source: c, action: N, info: { musicInfo: S, type: q } }) => {
    if ('musicUrl' != N) {
      throw Error('fialed')
    }
    return new Promise((G, F) => {
      let K = '/url/' + c + '/' + z(c, S) + '/' + q
      P.tag = T.buffer.bufToString(
        T.buffer.from(JSON.stringify(K.match(/(?:\d\w)+/g), null, 1)),
        'hex'
      )
      w(
        'http://97.64.37.235/flower/v1' + K,
        {
          method: 'GET',
          headers: P,
        },
        (b, D) =>
          b
            ? F(b)
            : 0 !== D.body.code
            ? F(Error(D.body.msg))
            : void G(D.body.data)
      )
    })
  })
  let L = (c) =>
      new Promise((N, S) => {
        w(c, { method: 'GET' }, (y, G, F) => {
          if (y || !G.body.vinfo) {
            return S(Error('FAILED'))
          }
          ;(F = G.body.vinfo?.[U.version])
            ? N({
                s: F.s,
                m: F.m,
                lv: G.body.vinfo.lv,
                lu: G.body.vinfo.lu,
                lh: G.body.vinfo.lh,
              })
            : N(null)
        })
      }),
    V = [
      'https://registry.npmjs.org/flower-source-info/latest',
      'https://registry.npmmirror.com/flower-source-info/latest',
    ],
    j = { s: 'kw|128k&wy|128k&mg|128k&tx|128k&kg|128k' }
  Promise.any([L(V[0]), L(V[1])])
    .then((c) => {
      j = c
    })
    .finally(() => {
      // if (!j || (j.m && T.crypto.md5(U.rawScript.trim()) != j.m)) {
      //   throw Error('服务器异常')
      // }
      let c = {}
      for (let S of j.s.trim().split('&'))
        c[(S = S.split('|')).shift()] = {
          type: 'music',
          actions: ['musicUrl'],
          qualitys: S,
        }
      const N = { sources: c }
      h(O.inited, N)
      j.lv &&
        parseInt(j.lv) > parseInt(U.version) &&
        h(O.updateAlert, {
          log: j.lu,
          updateUrl: j.lh,
        })
      h(O.inited, N),
        j.lv &&
          parseInt(j.lv) > parseInt(U.version) &&
          h(O.updateAlert, {
            log: j.lu,
            updateUrl: j.lh,
          })
    })
})()
