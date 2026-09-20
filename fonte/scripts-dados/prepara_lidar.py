#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara o MDT LiDAR de 2 m da DGT para o cozedor (gera_terreno.py).

Entrada: as folhas de 1x1 km da DGT (GeoTIFF, EPSG:3763, nodata lido de cada
ficheiro) em duas pastas, MDT-2m/ (terreno) e MDS-2m/ (superficie).

Saida, em EPSG:4326 como o cozedor exige:
  mdt_wgs84.tif   cotas do terreno
  chm_wgs84.tif   altura do coberto = MDS - MDT, cortada a 0..60 m

Regras que nao se negoceiam:
  - o nodata e o de CADA ficheiro (src.nodata); so se vier None se assume -999
  - mascara-se nos DOIS rasters ANTES de subtrair; onde qualquer um e nodata o
    CHM fica nodata -- nunca 0, porque 0 e "chao raso" e nao "nao sei"
  - no fim mede-se: nodata dentro da caixa (tem de ser 0) e a media do CHM nas
    manchas de floresta (tem de cair entre 8 e 20 m)

  python3 fonte/scripts-dados/prepara_lidar.py --pasta C:/.../lidar-manteigas \
      --caixa -7.62 40.31 -7.49 40.42
"""
import argparse, glob, os, sys, time
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.warp import calculate_default_transform, reproject, Resampling
from rasterio.windows import from_bounds

NODATA_DEFEITO = -999.0
NODATA_SAIDA = -9999.0   # distinto de qualquer cota ou altura plausivel


def nodata_de(caminho):
    with rasterio.open(caminho) as r:
        return r.nodata if r.nodata is not None else NODATA_DEFEITO


def mosaico(pasta):
    fs = sorted(glob.glob(os.path.join(pasta, '*.tif')))
    if not fs: sys.exit('sem folhas em %s' % pasta)
    nds = {nodata_de(f) for f in fs}
    if len(nds) != 1:
        sys.exit('folhas com nodata diferente em %s: %s' % (pasta, nds))
    nd = nds.pop()
    srcs = [rasterio.open(f) for f in fs]
    crs = {str(s.crs) for s in srcs}
    if len(crs) != 1: sys.exit('folhas com CRS diferente: %s' % crs)
    z, tr = merge(srcs, nodata=nd)
    perfil = srcs[0].profile.copy()
    for s in srcs: s.close()
    z = z[0].astype(np.float32)
    z[z == nd] = np.nan
    perfil.update(height=z.shape[0], width=z.shape[1], transform=tr, nodata=NODATA_SAIDA)
    print('%-8s %d folhas  nodata=%g  %dx%d px  crs %s' % (os.path.basename(pasta), len(fs), nd, z.shape[1], z.shape[0], perfil['crs']))
    return z, perfil


def para_4326(z, perfil, dest):
    """reprojecta para graus, bilinear; NaN entra e sai como nodata"""
    lim = rasterio.transform.array_bounds(perfil['height'], perfil['width'], perfil['transform'])
    tr, w, h = calculate_default_transform(perfil['crs'], 'EPSG:4326', perfil['width'], perfil['height'], *lim)
    out = np.full((h, w), np.nan, dtype=np.float32)
    reproject(source=np.where(np.isnan(z), NODATA_SAIDA, z).astype(np.float32), destination=out,
              src_transform=perfil['transform'], src_crs=perfil['crs'], src_nodata=NODATA_SAIDA,
              dst_transform=tr, dst_crs='EPSG:4326', dst_nodata=np.nan, resampling=Resampling.bilinear)
    p = perfil.copy()
    p.update(crs='EPSG:4326', transform=tr, width=w, height=h, nodata=NODATA_SAIDA,
             dtype='float32', count=1, compress='deflate', tiled=True, blockxsize=512, blockysize=512)
    with rasterio.open(dest, 'w', **p) as d:
        d.write(np.where(np.isnan(out), NODATA_SAIDA, out).astype(np.float32), 1)
    return out, tr


def dentro_da_caixa(arr, tr, caixa):
    win = from_bounds(*caixa, transform=tr)
    r0, r1 = int(np.floor(win.row_off)), int(np.ceil(win.row_off + win.height))
    c0, c1 = int(np.floor(win.col_off)), int(np.ceil(win.col_off + win.width))
    if r0 < 0 or c0 < 0 or r1 > arr.shape[0] or c1 > arr.shape[1]:
        sys.exit('a caixa sai fora do raster: linhas %d..%d de %d, colunas %d..%d de %d'
                 % (r0, r1, arr.shape[0], c0, c1, arr.shape[1]))
    return arr[r0:r1, c0:c1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pasta', required=True, help='pasta com MDT-2m/ e MDS-2m/')
    ap.add_argument('--caixa', nargs=4, type=float, required=True, metavar=('LO0', 'LA0', 'LO1', 'LA1'))
    ap.add_argument('--max-alt', type=float, default=60.0)
    a = ap.parse_args()
    t0 = time.time()

    mdt, p_mdt = mosaico(os.path.join(a.pasta, 'MDT-2m'))
    mds, p_mds = mosaico(os.path.join(a.pasta, 'MDS-2m'))
    if mdt.shape != mds.shape or p_mdt['transform'] != p_mds['transform']:
        sys.exit('MDT e MDS nao estao na mesma grelha: %s vs %s' % (mdt.shape, mds.shape))

    # CHM na grelha nativa de 2 m, com o nodata ja em NaN nos dois lados.
    # NaN - x = NaN e x - NaN = NaN: onde um falha, o resultado falha.
    chm = mds - mdt
    n_neg = int((chm < 0).sum()); n_alto = int((chm > a.max_alt).sum()); n_val = int(np.isfinite(chm).sum())
    chm = np.clip(chm, 0, a.max_alt)          # NaN passa incolume pelo clip
    print('CHM nativo: %d celulas validas; cortadas %d abaixo de 0 (%.2f%%) e %d acima de %g m (%.3f%%)'
          % (n_val, n_neg, 100.0 * n_neg / n_val, n_alto, a.max_alt, 100.0 * n_alto / n_val))
    print('   nodata: MDT %.3f%%  MDS %.3f%%  CHM %.3f%%'
          % tuple(100.0 * np.isnan(x).mean() for x in (mdt, mds, chm)))

    f_mdt = os.path.join(a.pasta, 'mdt_wgs84.tif'); f_chm = os.path.join(a.pasta, 'chm_wgs84.tif')
    mdt4, tr = para_4326(mdt, p_mdt, f_mdt)
    chm4, _ = para_4326(chm, p_mdt, f_chm)
    print('EPSG:4326  %dx%d px  pixel %.6f x %.6f graus (~%.1f x %.1f m)'
          % (mdt4.shape[1], mdt4.shape[0], tr.a, -tr.e, tr.a * 111320 * np.cos(np.radians(np.mean(a.caixa[1::2]))), -tr.e * 110540))

    # --- o que conta: dentro da caixa que vai ser cozida
    m_in = dentro_da_caixa(mdt4, tr, a.caixa); c_in = dentro_da_caixa(chm4, tr, a.caixa)
    nd_m = float(np.isnan(m_in).mean()) * 100; nd_c = float(np.isnan(c_in).mean()) * 100
    print('dentro da caixa: MDT nodata %.4f%%, CHM nodata %.4f%%' % (nd_m, nd_c))
    print('   cotas de %.1f a %.1f m' % (np.nanmin(m_in), np.nanmax(m_in)))
    print('   CHM: media %.1f m, mediana %.1f m, P95 %.1f m, celulas > 2 m: %.1f%%'
          % (np.nanmean(c_in), np.nanmedian(c_in), np.nanpercentile(c_in, 95), 100 * np.nanmean(c_in > 2)))
    print('\n%s\n%s\n%.0f s' % (f_mdt, f_chm, time.time() - t0))
    if nd_m > 0 or nd_c > 0:
        print('\nAVISO: ha nodata dentro da caixa. O cozedor tapa-o com a mediana -- confirma se e aceitavel.')


if __name__ == '__main__':
    main()
