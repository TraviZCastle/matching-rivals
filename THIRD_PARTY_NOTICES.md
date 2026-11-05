# Third-party vocabulary data

The generated question data in `data/question-banks.generated.json`, `lib/local-question-bank.generated.ts`, and the question-bank Supabase migrations is built from the following open datasets. It is not an official vocabulary list issued by any examination authority.

## ECDICT

- Project: [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)
- Use: CET-4, CET-6, IELTS and TOEFL membership tags; English headwords; Chinese translations; part-of-speech and frequency metadata for all five banks.
- License: MIT License.
- Copyright: Copyright (c) 2025 Linwei.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the conditions in the upstream license.

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The complete MIT license is available in the [upstream repository](https://github.com/skywind3000/ECDICT/blob/master/LICENSE).

## OpenEtymology public word books

- Project: [openetymology/OpenEtymology](https://github.com/openetymology/OpenEtymology)
- Use: TEM-8 vocabulary membership.
- Data license: [Creative Commons Attribution-ShareAlike 4.0 International](https://github.com/openetymology/OpenEtymology/blob/main/DATA_LICENSE.md).

## Princeton WordNet

- Project: [Princeton WordNet](https://wordnet.princeton.edu/)
- Distribution used: [NLTK WordNet corpus package](https://github.com/nltk/nltk_data/tree/gh-pages/packages/corpora)
- Use: identification of single-word person and place instances so proper names can be excluded before bank selection.
- License: [WordNet 3.0 License](https://wordnet.princeton.edu/license-and-commercial-use).

WordNet 3.0 is Copyright © 2006 by Princeton University. Its license permits use, copying, modification and distribution subject to retaining the copyright notice and disclaimer.

The generated question-bank data is a transformed subset: entries are filtered against the generated proper-name blocklist, assigned concise ECDICT translations and parts of speech, deduplicated across difficulty banks, and ranked for representative sampling. The generated data file is shared under CC BY-SA 4.0; this notice does not change the licensing of the application source code.
