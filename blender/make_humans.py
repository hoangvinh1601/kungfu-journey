"""Kungfu Journey - realistic martial-arts characters with MPFB2 (MakeHuman for Blender, CC0 assets).

Requirements: pip install bpy ; MPFB2 extension installed in Blender's user_default repo ;
MakeHuman "system assets" + "skins01/02" packs unzipped into MPFB's user data dir.
Run:  python3 make_humans.py OUT_DIR [name ...]
"""
import sys, os, math
import numpy as np
import bpy, addon_utils
from mathutils import Vector

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
ONLY = sys.argv[2:]
os.makedirs(OUT, exist_ok=True)

addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
D = LocationService.get_user_data()
A = lambda *p: os.path.join(D, *p)


def srgb_to_lin(c): return c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4


def tint_image(img, rgb, strength=1.0, gamma=0.85):
    """Re-dye a fabric texture: keep its luminance detail, replace the colour."""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., :3] @ np.array([.2126, .7152, .0722], dtype=np.float32)
    rel = np.clip(lum / max(1e-4, float(np.median(lum))), 0, 2.2) ** gamma
    col = np.array([int(rgb[i:i+2], 16)/255 for i in (1, 3, 5)], dtype=np.float32)
    out = np.clip(rel[..., None] * col[None, None, :], 0, 1)
    px[..., :3] = px[..., :3]*(1-strength) + out*strength
    img.pixels[:] = px.ravel()
    img.update()


def base_color_images(obj):
    imgs = []
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.node_tree: continue
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                for l in n.inputs['Base Color'].links:
                    if l.from_node.type == 'TEX_IMAGE' and l.from_node.image: imgs.append(l.from_node.image)
    return imgs


def bone_pos(rig, name, tail=False):
    b = next(b for b in rig.data.bones if b.name.split(':')[-1] == name)
    return rig.matrix_world @ (b.tail_local if tail else b.head_local)


def bone_full(rig, name):
    return next(b.name for b in rig.data.bones if b.name.split(':')[-1] == name)


def add_part(rig, name, V, F, groups, color, rough=.6, sheen=False):
    """groups: {short_bone_name: [vertex indices]} rigidly skinned."""
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    me.from_pydata(V, [], F); me.update()
    for p in me.polygons: p.use_smooth = True
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*[srgb_to_lin(int(color[i:i+2], 16)/255) for i in (1, 3, 5)], 1)
    bsdf.inputs['Roughness'].default_value = rough
    me.materials.append(mat)
    for bname, idx in groups.items():
        g = ob.vertex_groups.new(name=bone_full(rig, bname)); g.add(idx, 1.0, 'REPLACE')
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    return ob


def ring_mesh(center, axis, r_major, r_minor, seg=32, rs=8, scale2=(1.0, 1.0), axial=None):
    axis = Vector(axis).normalized()
    t1 = axis.orthogonal().normalized(); t2 = axis.cross(t1).normalized()
    V, F = [], []
    for i in range(seg):
        u = 2*math.pi*i/seg
        d = t1*math.cos(u)*scale2[0] + t2*math.sin(u)*scale2[1]
        for j in range(rs):
            v = 2*math.pi*j/rs
            V.append(tuple(Vector(center) + d*(r_major + r_minor*math.cos(v)) + axis*((axial or r_minor)*math.sin(v))))
    for i in range(seg):
        for j in range(rs):
            F.append((i*rs+j, ((i+1) % seg)*rs+j, ((i+1) % seg)*rs+(j+1) % rs, i*rs+(j+1) % rs))
    return V, F


def box_mesh(c, s, base=0):
    V, F = [], []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                V.append((c[0]+dx*s[0], c[1]+dy*s[1], c[2]+dz*s[2]))
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        F.append(tuple(base+k for k in f))
    return V, F


def mesh_verts(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg); me = ev.to_mesh()
    arr = np.array([ob.matrix_world @ v.co for v in me.vertices]); ev.to_mesh_clear(); return arr


def radial_size(verts, center, axis, half_len=.015, max_r=.12):
    """Median distance of mesh vertices from an axis, within a thin slab: the real sleeve / neck radius."""
    c = np.array(center); ax = np.array(axis); ax = ax/np.linalg.norm(ax)
    d = verts - c; t = d @ ax
    rad = np.linalg.norm(d - np.outer(t, ax), axis=1)
    sel = rad[(np.abs(t) < half_len) & (rad < max_r)]
    return float(np.percentile(sel, 80)) if len(sel) > 8 else None


def add_kungfu_details(rig, shirt, body, cuff='#ece8de', collar='#1d1d21', knot='#2e2e33'):
    """Tripo-style tang suit: rolled white cuffs, mandarin collar, frog-button knots down the chest."""
    sv = mesh_verts(shirt); bv = mesh_verts(body)
    for side in ('Left', 'Right'):
        w = bone_pos(rig, f'{side}Hand'); e = bone_pos(rig, f'{side}ForeArm')
        axis = (w - e).normalized(); c = w - axis*.05
        r = (radial_size(sv, c, axis) or .045) + .004
        V, F = ring_mesh(c, axis, r, .0055, seg=32, rs=10, axial=.028)
        add_part(rig, f'cuff_{side}', V, F, {f'{side}ForeArm': list(range(len(V)))}, cuff, .7)
    n = bone_pos(rig, 'Neck'); h = bone_pos(rig, 'Head'); ax = (h - n).normalized()
    c = n + ax*.015
    rs_ = radial_size(bv, n + ax*.05, ax, half_len=.01, max_r=.075)
    r = (rs_ or .05) + .006
    V, F = ring_mesh(c, ax, r, .005, seg=36, rs=10, axial=.016)
    add_part(rig, 'collar', V, F, {'Neck': list(range(len(V)))}, collar, .55)
    s1 = bone_pos(rig, 'Spine1'); nk = bone_pos(rig, 'Neck'); s2z = bone_pos(rig, 'Spine2').z
    V, F, gS1, gS2 = [], [], [], []
    for k in range(5):
        z = s1.z + .02 + (nk.z - .1 - s1.z) * k/4
        band = sv[(np.abs(sv[:, 0]) < .03) & (np.abs(sv[:, 2] - z) < .012)]
        if not len(band): continue
        y = band[:, 1].min() - .002
        grp = gS2 if z > s2z else gS1
        for cx, sz in ((0, (.024, .004, .0045)), (-.03, (.007, .006, .007)), (.03, (.007, .006, .007))):
            bv2, bf = box_mesh((cx, y, z), sz, base=len(V))
            grp.extend(range(len(V), len(V)+8)); V += bv2; F += bf
    add_part(rig, 'frog_buttons', V, F, {'Spine1': gS1, 'Spine2': gS2}, knot, .45)


def add_belt(rig, body, color, knot=True):
    """Martial-arts belt: elliptical torus around the waist + knot and tails, skinned to spine/hips."""
    bones = {b.name.split(':')[-1]: b for b in rig.data.bones}
    mw = rig.matrix_world
    spine = mw @ bones['Spine'].head_local
    z = spine.z - .015
    gi = body.vertex_groups.get('body')
    if gi is not None and body.type == 'MESH' and any(g.name == 'body' for g in body.vertex_groups):
        idx = gi.index
        verts = np.array([body.matrix_world @ v.co for v in body.data.vertices if any(g.group == idx and g.weight > .5 for g in v.groups)])
    else:
        verts = mesh_verts(body)
    ring = verts[(np.abs(verts[:, 2] - z) < .02) & (np.abs(verts[:, 0]) < .19)]
    cx, cy = float(np.median(ring[:, 0])), float(np.median(ring[:, 1]))
    rx = float(np.percentile(np.abs(ring[:, 0]-cx), 96)) + .03
    ry = float(np.percentile(np.abs(ring[:, 1]-cy), 96)) + .03
    me = bpy.data.meshes.new('belt'); ob = bpy.data.objects.new('belt', me); bpy.context.scene.collection.objects.link(ob)
    V, F = [], []
    seg, rs = 48, 6
    for i in range(seg):
        u = 2*math.pi*i/seg
        for j in range(rs):
            v = 2*math.pi*j/rs
            r = .011 if j % 3 else .013
            V.append((cx + (rx + r*math.cos(v))*math.cos(u), cy + (ry + r*math.cos(v))*math.sin(u), z + .022*math.sin(v)))
    for i in range(seg):
        for j in range(rs):
            F.append((i*rs+j, ((i+1) % seg)*rs+j, ((i+1) % seg)*rs+(j+1) % rs, i*rs+(j+1) % rs))
    groups = {}
    if knot:  # knot in front (-Y) and two hanging tails
        fy = cy - ry - .012
        def box(c, s, grp):
            b = len(V)
            for dx in (-1, 1):
                for dy in (-1, 1):
                    for dz in (-1, 1):
                        V.append((c[0]+dx*s[0], c[1]+dy*s[1], c[2]+dz*s[2]))
            for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
                F.append(tuple(b+k for k in f))
            groups.setdefault(grp, []).extend(range(b, b+8))
        box((cx+.03, fy, z), (.025, .012, .022), 'Spine')
        for k, dx in enumerate((.015, .05)):
            for t in range(4):
                box((cx+dx+.006*t*(1 if k else -1), fy-.004, z-.05-.045*t), (.016, .006, .024), 'Hips')
    me.from_pydata(V, [], F); me.update()
    for p in me.polygons: p.use_smooth = True
    mat = bpy.data.materials.new('belt')
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*[srgb_to_lin(int(color[i:i+2], 16)/255) for i in (1, 3, 5)], 1)
    bsdf.inputs['Roughness'].default_value = .75
    me.materials.append(mat)
    prefix = next(b.name for b in rig.data.bones if b.name.endswith('Hips'))[:-4]
    gs = ob.vertex_groups.new(name=prefix+'Spine'); gh = ob.vertex_groups.new(name=prefix+'Hips')
    gs.add(list(range(seg*rs)), 1.0, 'REPLACE')
    if groups.get('Spine'): gs.add(groups['Spine'], 1.0, 'REPLACE')
    if groups.get('Hips'): gh.add(groups['Hips'], 1.0, 'REPLACE')
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig


def build(name, spec):
    bpy.ops.wm.read_homefile(use_empty=True)
    macro = TargetService.get_default_macro_info_dict()
    macro.update({k: v for k, v in spec['macro'].items() if k != 'race'})
    macro['race'] = {'african': 0.0, 'asian': 0.0, 'caucasian': 0.0, **spec['macro'].get('race', {'asian': 1.0})}
    body = HumanService.create_human(macro_detail_dict=macro, feet_on_ground=True, scale=0.1)
    TargetService.bake_targets(body)
    rig = HumanService.add_builtin_rig(body, 'mixamo')
    HumanService.set_character_skin(A('skins', spec['skin'], spec['skin'] + '.mhmat'), body, skin_type='GAMEENGINE')
    assets = [(A('eyes', 'low-poly', 'low-poly.mhclo'), 'Eyes'),
              (A('eyebrows', spec.get('brow', 'eyebrow001'), spec.get('brow', 'eyebrow001') + '.mhclo'), 'Eyebrows'),
              (A('eyelashes', 'eyelashes01', 'eyelashes01.mhclo'), 'Eyelashes'),
              (A('hair', spec['hair'], spec['hair'] + '.mhclo'), 'Hair')]
    assets += [(A('clothes', c, c + '.mhclo'), 'Clothes') for c in spec['clothes']]
    for path, kind in assets:
        HumanService.add_mhclo_asset(path, body, asset_type=kind, subdiv_levels=0, material_type='GAMEENGINE')
    # re-dye clothes / hair
    for ob in bpy.data.objects:
        if ob.type != 'MESH': continue
        key = next((k for k in spec.get('dye', {}) if k in ob.name.lower()), None)
        if key:
            for img in base_color_images(ob):
                tint_image(img, spec['dye'][key])
    shirt = next((o for o in bpy.data.objects if o.type == 'MESH' and 'suit' in o.name.lower()), body)
    for ob in bpy.data.objects:
        if ob.type != 'MESH': continue
        nm = ob.name.lower()
        hairy = any(k in nm for k in ('eyebrow', 'eyelash', spec['hair']))
        for slot in ob.material_slots:
            m = slot.material
            if not m or not m.node_tree: continue
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    if not hairy:
                        for l in list(n.inputs['Alpha'].links): m.node_tree.links.remove(l)
                        n.inputs['Alpha'].default_value = 1.0
                    if 'suit' in nm and spec.get('silk'):
                        n.inputs['Roughness'].default_value = .55
    if spec.get('dye_lower'):
        key, col = spec['dye_lower']; waist = bone_pos(rig, 'Spine').z - .02
        ob = next(o for o in bpy.data.objects if o.type == 'MESH' and key in o.name.lower())
        m0 = ob.material_slots[0].material; m1 = m0.copy(); m1.name = m0.name + '_lower'
        for nd in m1.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and 'normal' not in nd.image.name.lower():
                im = nd.image.copy(); im.name = nd.image.name + '_lower'; tint_image(im, col); nd.image = im
        ob.data.materials.append(m1); li = len(ob.data.materials) - 1
        mw = ob.matrix_world
        for poly in ob.data.polygons:
            if (mw @ poly.center).z < waist: poly.material_index = li
    if spec.get('belt'): add_belt(rig, body, spec['belt'], knot=True)
    if spec.get('kungfu'): add_kungfu_details(rig, shirt, body)
    # remove any subdivision, shrink textures
    for ob in bpy.data.objects:
        for m in list(getattr(ob, 'modifiers', [])):
            if m.type == 'SUBSURF': ob.modifiers.remove(m)
    for img in bpy.data.images:
        if img.size[0] == 0: continue
        lim = 2048 if 'skin' in img.name.lower() or img.name.lower().startswith(spec['skin'][:6]) else 1024
        if 'eye' in img.name.lower() and 'brow' not in img.name.lower(): lim = 256
        if max(img.size) > lim:
            s = lim / max(img.size); img.scale(int(img.size[0]*s), int(img.size[1]*s))
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_skins=True,
                              export_animations=False, export_morph=False, export_yup=True,
                              export_image_format='WEBP', export_image_quality=82)
    print(f'== {name}: {os.path.getsize(path)//1024} KB, bones={len(rig.data.bones)}, '
          f'objects={[o.name for o in bpy.data.objects if o.type == "MESH"]}')


HUMANS = {
    # Vovinam master: blue uniform, yellow belt, barefoot
    'vovinam': dict(macro=dict(gender=1.0, age=0.6, muscle=0.72, weight=0.55, height=0.55, proportions=0.75, race={'asian': 1.0}),
                    skin='young_asian_male', hair='short02', brow='eyebrow001',
                    clothes=['male_casualsuit01'], dye={'casualsuit': '#1f4aa0', 'short02': '#141010'}, belt='#e3b11f'),
    # young female wushu athlete: red top, black pants, ponytail, sneakers
    'nu_vo_sinh': dict(macro=dict(gender=0.0, age=0.42, muscle=0.65, weight=0.45, height=0.5, proportions=0.8, race={'asian': 1.0}),
                       skin='young_asian_female', hair='ponytail01', brow='eyebrow010',
                       clothes=['female_sportsuit01', 'shoes05'], dye={'sportsuit': '#b3262a', 'ponytail': '#16110e'},
                       dye_lower=('sportsuit', '#1a1a1f')),
    # kung fu master: black silk tang suit, white cuffs, frog buttons, black cloth shoes (matches the Tripo concept)
    'su_phu': dict(macro=dict(gender=1.0, age=0.7, muscle=0.7, weight=0.52, height=0.55, proportions=0.75, race={'asian': 1.0}),
                   skin='middleage_asian_male', hair='short02', brow='eyebrow004',
                   clothes=['male_casualsuit01', 'shoes04'], dye={'casualsuit': '#1d1d21', 'short02': '#121010', 'shoes04': '#151515'},
                   kungfu=True, silk=True),
    # karate student: white gi, black belt, barefoot
    'karate': dict(macro=dict(gender=1.0, age=0.45, muscle=0.6, weight=0.5, height=0.6, proportions=0.7, race={'asian': 0.8, 'caucasian': 0.2}),
                   skin='young_asian_male', hair='short01', brow='eyebrow002',
                   clothes=['male_casualsuit01'], dye={'casualsuit': '#f2f0ea', 'short01': '#1a1412'}, belt='#151313'),
}

if __name__ == '__main__':
    for n, s in HUMANS.items():
        if not ONLY or n in ONLY:
            build(n, s)
