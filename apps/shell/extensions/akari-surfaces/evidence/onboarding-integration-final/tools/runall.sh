#!/bin/bash
WT=$1; L=$2
for p in gpu-export osr-export akari-surfaces akari-preview akari-annotations preview-server render-cut; do
  bash C:/t/oif/runpkg.sh $WT $L $p >> C:/t/oif/l0/$L.progress 2>&1
done
echo ALLDONE >> C:/t/oif/l0/$L.progress
