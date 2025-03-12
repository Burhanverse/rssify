// Escape XML helper
export function escapeXML(str) {
    return str.replace(/[<>"']/g, (char) => {
        switch (char) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return char;
        }
    });
}

// Escape HTML helper
export function escapeHTML(str) {
    return str.replace(/[<>"']/g, (match) => {
        switch (match) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return match;
        }
    });
}
