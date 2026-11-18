"""Kungfu Journey - procedural martial-arts characters built with Blender (bpy).

Run:  python3 make_characters.py  [out_dir]
Each character gets a Mixamo-named armature (T-pose, faces -Y in Blender = +Z in glTF)
and a single skinned mesh whose parts are rigidly weighted to one bone each
(an "action figure" build that deforms cleanly at every joint).
"""
import sys, math, os
import bpy, bmesh
from mathutils import Vector, Matrix

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else 'out'
os.makedirs(OUT, exist_ok=True)

P = 'mixamorig:'
# joint positions in metres (Blender: X = character's left, -Y = forward, Z = up)
J = {
    'Hips': (0, 0, .96), 'Spine': (0, 0, 1.06), 'Spine1': (0, 0, 1.17), 'Spine2': (0, 0, 1.28),
    'Neck': (0, 0, 1.47), 'Head': (0, 0, 1.55), 'HeadTop_End': (0, 0, 1.76),
}
for s, sx in (('Left', 1), ('Right', -1)):
    J.update({
        f'{s}Shoulder': (.03*sx, 0, 1.42), f'{s}Arm': (.17*sx, 0, 1.43), f'{s}ForeArm': (.44*sx, 0, 1.43),
        f'{s}Hand': (.68*sx, 0, 1.43), f'{s}HandEnd': (.79*sx, 0, 1.43),
        f'{s}UpLeg': (.095*sx, 0, .93), f'{s}Leg': (.095*sx, 0, .52), f'{s}Foot': (.095*sx, .01, .10),
        f'{s}ToeBase': (.095*sx, -.11, .03), f'{s}Toe_End': (.095*sx, -.2, .03),
    })
HIER = [('Hips', None, 'Spine'), ('Spine', 'Hips', 'Spine1'), ('Spine1', 'Spine', 'Spine2'), ('Spine2', 'Spine1', 'Neck'),
        ('Neck', 'Spine2', 'Head'), ('Head', 'Neck', 'HeadTop_End'), ('HeadTop_End', 'Head', None)]
for s in ('Left', 'Right'):
    HIER += [(f'{s}Shoulder', 'Spine2', f'{s}Arm'), (f'{s}Arm', f'{s}Shoulder', f'{s}ForeArm'), (f'{s}ForeArm', f'{s}Arm', f'{s}Hand'),
             (f'{s}Hand', f'{s}ForeArm', f'{s}HandEnd'), (f'{s}HandEnd', f'{s}Hand', None),
             (f'{s}UpLeg', 'Hips', f'{s}Leg'), (f'{s}Leg', f'{s}UpLeg', f'{s}Foot'), (f'{s}Foot', f'{s}Leg', f'{s}ToeBase'),
             (f'{s}ToeBase', f'{s}Foot', f'{s}Toe_End'), (f'{s}Toe_End', f'{s}ToeBase', None)]
BONES = [h[0] for h in HIER]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_armature(name):
    arm = bpy.data.armatures.new(name + '_Rig')
    ob = bpy.data.objects.new(name + '_Rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b, parent, child in HIER:
        e = arm.edit_bones.new(P + b)
        e.head = Vector(J[b])
        if child:
            e.tail = Vector(J[child])
        else:  # leaf: extend along the parent direction
            d = Vector(J[b]) - Vector(J[parent]); e.tail = Vector(J[b]) + d.normalized() * .06
        if parent:
            e.parent = eb[parent]; e.use_connect = False
        eb[b] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.dl = self.bm.verts.layers.deform.verify()
        self.mats = []

    def mat(self, rgb, rough=.6, metal=0.0):
        key = (rgb, rough, metal)
        for i, m in enumerate(self.mats):
            if m[0] == key: return i
        m = bpy.data.materials.new(f'm{len(self.mats)}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        r, g, b = [int(rgb[i:i+2], 16)/255 for i in (1, 3, 5)]
        lin = lambda c: c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4
        bsdf.inputs['Base Color'].default_value = (lin(r), lin(g), lin(b), 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        self.mats.append((key, m)); return len(self.mats) - 1

    def _finish(self, verts, M, bone, mi, smooth=True):
        bmesh.ops.transform(self.bm, matrix=M, verts=verts)
        gi = BONES.index(bone)
        faces = set()
        for v in verts:
            v[self.dl][gi] = 1.0
            faces.update(v.link_faces)
        for f in faces:
            f.material_index = mi; f.smooth = smooth

    def sphere(self, c, r, bone, mi, seg=24):
        rx, ry, rz = (r, r, r) if isinstance(r, (int, float)) else r
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(8, seg//2), radius=1)
        M = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((rx, ry, rz, 1))
        self._finish(res['verts'], M, bone, mi)

    def tube(self, a, b, r1, r2, bone, mi, seg=22, sx=1.0):
        a, b = Vector(a), Vector(b); d = b - a; L = d.length
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=L)
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        M = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((sx, 1, 1, 1))
        self._finish(res['verts'], M, bone, mi)

    def box(self, c, size, bone, mi, rot=None):
        res = bmesh.ops.create_cube(self.bm, size=1)
        M = Matrix.Translation(Vector(c)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
        self._finish(res['verts'], M, bone, mi, smooth=False)

    def torus(self, c, R, r, bone, mi, sy=1.0, axis=(0, 0, 1), seg=36, ring=10):
        verts = []
        for i in range(seg):
            u = 2*math.pi*i/seg
            for j in range(ring):
                v = 2*math.pi*j/ring
                verts.append(self.bm.verts.new(((R + r*math.cos(v))*math.cos(u), (R + r*math.cos(v))*math.sin(u)*sy, r*math.sin(v))))
        for i in range(seg):
            for j in range(ring):
                a = verts[i*ring + j]; b = verts[((i+1) % seg)*ring + j]
                c2 = verts[((i+1) % seg)*ring + (j+1) % ring]; d = verts[i*ring + (j+1) % ring]
                self.bm.faces.new((a, b, c2, d))
        rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
        self._finish(verts, Matrix.Translation(Vector(c)) @ rot, bone, mi)


def body(B, C):
    """Shared figure. C = colour/feature spec."""
    skin = B.mat(C['skin'], .55)
    top = B.mat(C['top'], C.get('top_rough', .7))
    pants = B.mat(C['pants'], .75)
    shoe = B.mat(C.get('shoe', '#1a1714'), .5)
    belt = B.mat(C['belt'], .5)
    dark = B.mat('#1b1412', .4)
    sleeve = B.mat(C.get('sleeve', C['top']), .7)
    joint = B.mat(C['joint'], .5) if C.get('joint') else None
    # head
    B.sphere((0, -.004, 1.638), (.105, .112, .122), 'Head', skin)
    B.tube((0, 0, 1.44), (0, 0, 1.56), .05, .048, 'Neck', skin)
    if C.get('face', True):
        for sx in (1, -1):
            B.sphere((.04*sx, -.104, 1.652), (.015, .008, .019), 'Head', dark, seg=12)
            B.box((.043*sx, -.108, 1.684), (.034, .008, .009), 'Head', dark, rot=Matrix.Rotation(-.18*sx, 4, 'Y'))
            B.sphere((.104*sx, 0, 1.64), (.016, .026, .034), 'Head', skin, seg=12)
        B.sphere((0, -.117, 1.625), (.014, .012, .018), 'Head', skin, seg=12)
        B.box((0, -.108, 1.592), (.032, .006, .006), 'Head', B.mat('#7a2b24', .5))
    # torso
    B.sphere((0, 0, .975), (.155, .108, .11), 'Hips', pants)
    B.sphere((0, 0, 1.125), (.142, .1, .13), 'Spine', top)
    B.sphere((0, -.002, 1.31), (.178, .112, .165), 'Spine2', top)
    if C.get('vneck'):
        B.box((0, -.108, 1.40), (.07, .012, .07), 'Spine2', B.mat(C['vneck'], .6), rot=Matrix.Rotation(math.radians(45), 4, 'Y'))
    # belt + knot + tails
    B.torus((0, 0, 1.03), .15, .022, 'Spine', belt, sy=.72)
    B.sphere((.045, -.11, 1.03), (.03, .016, .028), 'Spine', belt, seg=12)
    for k, (x2, z2) in enumerate(((.06, .86), (.03, .88))):
        B.tube((.045 + .01*k, -.112, 1.02), (x2, -.12, z2), .016, .012, 'Hips', belt, seg=8, sx=.5)
    for s, sx in (('Left', 1), ('Right', -1)):
        A, F, H = Vector(J[f'{s}Arm']), Vector(J[f'{s}ForeArm']), Vector(J[f'{s}Hand'])
        B.sphere(A + Vector((0, 0, .005)), .068, f'{s}Arm', top)
        B.tube(A, F, .058, .05, f'{s}Arm', top)
        B.sphere(F, .05, f'{s}ForeArm', joint if joint is not None else sleeve)
        B.tube(F, H - Vector((.01*sx, 0, 0)), .049, C.get('cuff_r', .042), f'{s}ForeArm', sleeve)
        if C.get('cuff'):
            B.torus(H - Vector((.03*sx, 0, 0)), .046, .011, f'{s}ForeArm', B.mat(C['cuff'], .35, .6), axis=(1, 0, 0))
        B.sphere(H + Vector((.045*sx, 0, -.004)), (.058, .047, .052), f'{s}Hand', B.mat(C.get('glove', C['skin']), .55))
        U, K, Fo = Vector(J[f'{s}UpLeg']), Vector(J[f'{s}Leg']), Vector(J[f'{s}Foot'])
        B.sphere(U + Vector((0, 0, .01)), .092, f'{s}UpLeg', pants)
        B.tube(U, K, C.get('thigh_r', .088), .07, f'{s}UpLeg', pants)
        B.sphere(K, .068, f'{s}Leg', joint if joint is not None else pants)
        shin = B.mat(C['wrap'], .8) if C.get('wrap') else pants
        B.tube(K, Fo + Vector((0, 0, .03)), C.get('shin_r', .068), .052, f'{s}Leg', shin)
        if C.get('wrap'):
            for t in range(4):
                z = .18 + t*.075
                B.torus((J[f'{s}Leg'][0], 0, z), .056 + t*.003, .007, f'{s}Leg', B.mat(C['wrap_line'], .8))
        B.sphere((J[f'{s}Foot'][0], -.035, .055), (.054, .1, .048), f'{s}Foot', shoe)
        B.sphere((J[f'{s}Foot'][0], -.135, .038), (.05, .07, .034), f'{s}ToeBase', shoe)
        B.box((J[f'{s}Foot'][0], -.06, .006), (.1, .26, .012), f'{s}Foot', B.mat(C.get('sole', '#e8e0d0'), .8))


def hair_short(B, col):
    m = B.mat(col, .5)
    B.sphere((0, .012, 1.668), (.114, .118, .108), 'Head', m)
    B.sphere((0, -.06, 1.718), (.085, .06, .04), 'Head', m)


def build(name, C, extra=None):
    reset()
    rig = make_armature(name)
    B = Builder()
    body(B, C)
    if extra: extra(B)
    me = bpy.data.meshes.new(name)
    B.bm.to_mesh(me); B.bm.free()
    for _, m in B.mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for b in BONES: ob.vertex_groups.new(name=P + b)
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_skins=True,
                              export_animations=False, export_apply=False)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(f'{name}: {os.path.getsize(path)//1024} KB, {tris} tris')


# ---------------- characters ----------------
def vovinam_extra(B):
    hair_short(B, '#16110f')
    # Vovinam emblem patch on the chest
    B.sphere((-.075, -.105, 1.36), (.03, .006, .03), 'Spine2', B.mat('#d6312b', .5), seg=16)
    B.sphere((-.075, -.109, 1.36), (.018, .004, .018), 'Spine2', B.mat('#f2d23c', .5), seg=16)


def monk_extra(B):
    bead = B.mat('#4a2a17', .35)
    for i in range(22):  # prayer beads draped over the chest
        a = 2*math.pi*i/22
        x, y = .13*math.sin(a), -.09*math.cos(a)
        z = 1.42 - .1*max(0, math.cos(a))
        B.sphere((x, y - .02, z), .017, 'Spine2', bead, seg=10)
    B.sphere((0, -.12, 1.27), .026, 'Spine2', B.mat('#b2341f', .4), seg=12)
    sash = B.mat('#8a2a1a', .6)  # robe cross-over
    B.box((.0, -.112, 1.30), (.03, .012, .3), 'Spine2', sash, rot=Matrix.Rotation(math.radians(-28), 4, 'Y'))
    for k in range(3):  # ordination dots on the shaved head
        B.sphere(((k-1)*.03, -.035, 1.758), .006, 'Head', B.mat('#c9a083', .6), seg=8)


def heroine_extra(B):
    hair = B.mat('#120d0c', .45)
    hair_short(B, '#120d0c')
    B.sphere((0, .085, 1.73), .055, 'Head', hair)                          # bun
    B.torus((0, .085, 1.73), .056, .012, 'Head', B.mat('#d4432c', .4), axis=(0, 1, .4))
    B.tube((0, .1, 1.66), (0, .14, 1.36), .03, .018, 'Head', hair, seg=12)   # ponytail
    for sx in (1, -1):  # ribbon tails
        B.box((.03*sx, .13, 1.66), (.018, .006, .14), 'Head', B.mat('#d4432c', .4), rot=Matrix.Rotation(.25*sx, 4, 'Y'))
    B.box((0, -.11, 1.35), (.05, .012, .16), 'Spine2', B.mat('#d9a54a', .35, .4))  # frog buttons strip
    for z in (1.30, 1.36, 1.42):
        B.sphere((0, -.118, z), .011, 'Spine2', B.mat('#d9a54a', .3, .6), seg=8)


def wooden_extra(B):
    ring = B.mat('#b08d3a', .3, .8)
    for s in ('Left', 'Right'):
        for b in (f'{s}ForeArm', f'{s}Leg'):
            B.torus(J[b], .056, .01, b, ring, axis=(1, 0, 0) if 'Arm' in b else (0, 0, 1))
    B.torus((0, 0, 1.47), .055, .01, 'Neck', ring)
    for sx in (1, -1):  # carved eyes
        B.box((.04*sx, -.108, 1.652), (.035, .006, .006), 'Head', B.mat('#3a2414', .7))


CHARS = {
    'vovinam': dict(skin='#d9a27c', top='#1f4fa8', pants='#1f4fa8', belt='#e8b923', shoe='#1a1714', sole='#e8e0d0'),
    'monk': dict(skin='#c98f68', top='#e08a26', pants='#c46a18', belt='#8a2a1a', wrap='#efe3c6', wrap_line='#c9b896',
                 shoe='#3b2a1d', sole='#2a1d14', cuff_r=.05, vneck='#c98f68'),
    'heroine': dict(skin='#e6b694', top='#b3262a', sleeve='#b3262a', pants='#16161c', belt='#d9a54a', cuff='#d9a54a',
                    shoe='#16161c', sole='#d9cfc0', thigh_r=.092, shin_r=.072),
    'wooden': dict(skin='#a8743f', top='#a8743f', pants='#a8743f', belt='#c0392b', joint='#6b4524', glove='#8c5e31',
                   shoe='#6b4524', sole='#4a3019', face=False),
}
EXTRA = {'vovinam': vovinam_extra, 'monk': monk_extra, 'heroine': heroine_extra, 'wooden': wooden_extra}

if __name__ == '__main__':
    for n, c in CHARS.items():
        build(n, c, EXTRA[n])
