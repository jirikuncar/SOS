## A small script to retrieve DNA and mRNA sequence around fusion breakpoints

### Prerequisite

This script uses the [sequence](http://varianttools.sourceforge.net/VtoolsReport/Sequence) reporting tool of [variant tools](https://github.com/vatlab/VariantTools)
to retrieve DNA and RNA sequences around a fusion breakpoint. Please install variant tools from github before you try to use it.

Before you use the workflow, you will need to initialize the project and download required reference genomes. This can be done using commands

```
vtools init fusion --build hg19 -f
```

### Workflows

This script defines five workflow that can be used as


```
sos run Fusion_squences DNA --break-point chr1:186337017>chr1:89251786 --gene1 TPR --gene2 PKN2 --lead 50 --filename output.txt
```

```
sos run Fusion_squences DNA --break-point chr1:186337017>chr1:89251786 --gene1 TPR --gene2 PKN2 --lead 50 --filename output.txt
```
