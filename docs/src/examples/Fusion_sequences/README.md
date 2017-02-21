## A small script to retrieve DNA and mRNA sequence around fusion breakpoints

### Prerequisite

This script uses the [sequence](http://varianttools.sourceforge.net/VtoolsReport/Sequence) reporting tool of [variant tools](https://github.com/vatlab/VariantTools)
to retrieve DNA and RNA sequences around a fusion breakpoint. Please install variant tools from github before you try to use it.

```
git clone http://github.com/vatlab/VariantTools.git
cd VariantTools
python setup.py install
```

Before you use the workflow, you will need to initialize the project and download required reference genomes. This can be done using commands

```
vtools init fusion --build hg19 -f
```

### Workflows

This script defines five workflows. The `DNA` workflow outputs DNA sequence to the left and right of the breakpoint


```
$ sos run Fusion_sequences DNA --break-point 'chr1:186337017>chr1:89251786' --gene1 TPR --gene2 PKN2
INFO: Executing DNA_0: Get DNA sequence for a particular fusion candidate with parameter break_point:  break point in the format of chr1:pos1>chr2:pos2 gene1:  5-prime gene gene2:  3-prime gene filename: a filename to write output lead:     length of left and right sequence around the breakpoint
INFO: DNA_0 input:    []

==> TPR > PKN2  chr1:186337017>chr1:89251786
AGAAGAAAAATAAAGGAATGGAGCTAAAAGCTACAAGCACTTCTTCATACC
ATGATGTCTGTGCTGTTTTGAAGCTCGATAATACTGTGGTTGGCCAAACTA
INFO: DNA_0 output:   []
INFO: Workflow DNA (ID=156a47b6d20e6d35) is executed successfully.
```

The `RNA` workflow outputs mRNA sequence (transcribed from RNA sequence, reverse if on reverse strand)

```
$ sos run Fusion_sequences RNA --break-point 'chr1:186337017>chr1:89251786' --gene1 TPR --gene2 PKN2
INFO: Executing RNA_0: Get RNA sequence for a particular fusion candidate with parameter break_point:  break point in the format of chr1:pos1>chr2:pos2 gene1:  5-prime gene gene2:  3-prime gene
INFO: RNA_0 input:    []

==> TPR > PKN2  chr1:186337017>chr1:89251786
>mRNA|NM_003292|chr1:186344160-186344010,186342595-186342491,186340175-186340102,186337114-186337018,186332577-186332474,186332133-186331969,186331512-186331420,186331001-186330921,186330841-186330754,186330037-186329897,186329496-186329405,186329128-186328931,186327782-186327675,186326755-186326529,186325581-186325418,186324900-186324767,186324690-186324542,186322982-186322820,186321242-186321108,186320602-186320462,186319520-186319355,186316590-186316424,186315419-186315267,186314828-186314712,186313710-186313507,186313222-186313038,186312605-186312458,186310521-186310384,186310291-186310160,186308904-186308774,186307375-186307165,186306288-186306145,186305826-186305628,186304675-186304470,186304261-186304200,186303665-186303457,186302526-186302254,186301475-186301327,186300713-186300630,186296792-186296592,186295367-186295236,186294986-186294896,186293002-186292818,186291718-186291650,186291544-186291450,186289550-186289444,186287960-186287865,186287735-186287579,186286732-186286614,186283856-186283761,186283158-186283103 (7092 bp on reverse strand)
G
>mRNA|NM_006256|chr1:89150264-89150311,89206671-89206971,89225905-89226059,89236035-89236152,89237104-89237249,89237346-89237562,89250322-89250507,89251787-89251896,89270074-89270217,89270529-89270604,89271180-89271354,89271574-89271700,89272996-89273126,89273212-89273287,89273367-89273458,89279240-89279416,89287624-89287686,89289993-89290069,89294164-89294306,89298427-89298534,89298760-89298840,89298928-89299131 (2955 bp)
AUGAUGUCUGUGCUGUUUUGAAGCUCGAUAAUACUGUGGUUGGCCAAACUA
INFO: RNA_0 output:   []
INFO: Workflow RNA (ID=f9b67c6f08fc840d) is executed successfully.
```

You can use options `--lead` to define length of sequences, and `--filename` to output to specified file.

```
$ sos run Fusion_sequences DNA --break-point 'chr1:186337017>chr1:89251786' --gene1 TPR --gene2 PKN2 --lead 100 --filename output.txt
$ cat output.txt

==> TPR > PKN2  chr1:186337017>chr1:89251786
AAAAAATATCAGCAACAGAAATGGGCTGAGCACTAACTCCTAGCACTAACAGAAGAAAAATAAAGGAATGGAGCTAAAAGCTACAAGCACTTCTTCATACC
ATGATGTCTGTGCTGTTTTGAAGCTCGATAATACTGTGGTTGGCCAAACTAGCTGGAAACCCATTTCCAATCAGTCATGGGACCAGAAGTTTACACTGGAA
```

The other workflows get fusions from `fusions.xls` (actually a tab-delimited text file) for all samples in the current directory. They are written for a 
particular workflow that filters fusions using oncofuse on tophat generated fusion candidates. They are kept as examples of how to use input loop and
how to call nested workflows.
