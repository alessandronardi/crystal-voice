"""Simulazione della revisione avversariale v0.2 (dati sintetici). Uso: python3 sim_v02.py"""
import numpy as np
rng=np.random.default_rng(1)
N=200000
def aff(a,b): return 100*np.clip(1-np.sqrt(((a-b)/100)**2 @ (np.ones(6)/6)),0,1)
u1=rng.uniform(0,100,(N,6));u2=rng.uniform(0,100,(N,6))
a=aff(u1,u2);print("uniform mean %.1f p5 %.1f p50 %.1f p95 %.1f"%(a.mean(),*np.percentile(a,[5,50,95])))
g1=np.clip(rng.normal(50,15,(N,6)),0,100);g2=np.clip(rng.normal(50,15,(N,6)),0,100)
a=aff(g1,g2);print("normal sd15 mean %.1f p5 %.1f p50 %.1f p95 %.1f"%(a.mean(),*np.percentile(a,[5,50,95])))
# bin flip prob: same speaker two clips, p1 true uniform, noise sigma
for s in [1,2,4,8]:
    t=rng.uniform(0,100,N); x1=np.clip(t+rng.normal(0,s,N),0,100); x2=np.clip(t+rng.normal(0,s,N),0,100)
    n=lambda p:3+np.minimum(9,np.floor(10*p/100))
    print("sigma",s,"flip %.2f"%np.mean(n(x1)!=n(x2)))
