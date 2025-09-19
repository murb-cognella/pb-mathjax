'use strict';

const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { MathML } = require('mathjax-full/js/input/mathml.js');
const { AsciiMath } = require('mathjax-full/js/input/asciimath.js');
const { HTMLDocument } = require('mathjax-full/js/handlers/html/HTMLDocument.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');
const { decode } = require('html-entities');
const {STATE} = require('mathjax-full/js/core/MathItem.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const mathml = new MathML();
const asciimath = new AsciiMath();

function handleError(res) {
    res.set('pb-mathjax-error', 'Formula does not parse');
    const path = require('path');
    return res.status(400).sendFile(path.resolve('public/images/formula_does_not_parse.png'));
}

module.exports.generate = async (configs, req, res, next) => {
    const query = configs.query || {};

    //   let isSvg = query.svg === true || query.svg === '1' || query.svg === 'true';
    let forceInline = query.inline === true || query.inline === '1' || query.inline === 'true';

    const packages = AllPackages.filter((name) => name !== 'bussproofs');

    // Configure TeX input
    let tex = new TeX({
        packages: configs.typeset.math.includes('\\require{physics}') ? packages.concat(['physics']) : packages,
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']]
    });

    let inputFormat = tex;

    switch (configs.typeset.format) {
        case 'TeX':
            break;
        case 'MathML':
            inputFormat = mathml;
            break;
        case 'AsciiMath':
            inputFormat = asciimath;
            break;
        default:
            return handleError(res);
    }

    //   const mathJaxDocument = mathjax.document('', {
    //     InputJax: inputFormat,
    //     OutputJax: 'MathML'
    //   });
    const html = new HTMLDocument('', liteAdaptor(), {InputJax: tex});

    const {SerializedMmlVisitor} = require('mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js');
    const visitor = new SerializedMmlVisitor();
    const toMathML = (node => visitor.visitTree(node, html));

    function isValidColor(str) {
        return /^#[a-f0-9]{6}$/i.test(`#${str}`);
    }

    function stripRequireCommands(math) {
        return math.replace(/\\require\s*\{[^}]*\}\s*/g, '');
    }

    // myForeground = isValidColor(myForeground) ? `#${myForeground}` : '#000000';

    try {
        if (!configs?.typeset?.math) {
            return handleError(res);
        }

        let decodedMath = configs.typeset.math;

        try {
            // Temporarily encode LaTeX percent signs to avoid issues with decodeURIComponent
            decodedMath = decodedMath.replace(/\\\%/g, "__PERCENT__");
            // Handle MathML percent signs within tags
            decodedMath = decodedMath.replace(/(<[^>]*>)([^<]*?)(<\/[^>]*>)/g, (match, openTag, content, closeTag) => {
                if (content.includes('%')) {
                    const newContent = content.replace(/\\?%/g, '__MATHPERCENT__');
                    return openTag + newContent + closeTag;
                }
                return match;
            });

            decodedMath = decodeURIComponent(decodedMath);
            // Restore LaTeX and MathML percent signs
            decodedMath = decodedMath.replace(/__PERCENT__/g, "\\%");
            decodedMath = decodedMath.replace(/__MATHPERCENT__/g, "%");
            decodedMath = decodedMath.replace(/&#038;/g, "&").replace(/&#38;/g, "&");
            decodedMath = decode(decodedMath);
        } catch (decodeError) {
            return handleError(res);
        }

        const math = stripRequireCommands(decodedMath);
        const isInline = (math.startsWith('\\(') && math.endsWith('\\)')) ||
            (math.startsWith('$') && math.endsWith('$') && !math.startsWith('$$'));
        const isBlock = (math.startsWith('\\[') && math.endsWith('\\]')) ||
            (math.startsWith('$$') && math.endsWith('$$'));

        let cleanMath = math.trim();
        if (isInline) {
            cleanMath = math.slice(math.startsWith('\\(') ? 2 : 1, -2);
        } else if (isBlock) {
            cleanMath = math.slice(2, -2);
        }

        try {


            let math = toMathML(html.convert(cleanMath, {display: !forceInline && !isInline, end: STATE.CONVERT}));

            // let mathMlContent = adaptor.innerHTML(node);

            if (!math || !math.includes('<math') || !math.includes('</math>')) {
                return handleError(res);
            }

            res.set('Content-Type', 'application/mathml+xml')
            return res.send(math);
        } catch (err) {
            return handleError(res);
        }
    } catch (error) {
        return handleError(res);
    }
};