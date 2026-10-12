function i(t,n=performance.timeOrigin){if(t<=1n)return;let r=Number(t>>32n)-2208988800,e=Number(t&0xFFFFFFFFn)/4294967296;return(r+e)*1e3-n}function c(t,n=performance.timeOrigin){return o(t+n)}function o(t){let n=t/1e3+2208988800,r=Math.floor(n),e=Math.round((n-r)*4294967296);return BigInt(r)<<32n|BigInt(e)}export{i as a,c as b};
//# sourceMappingURL=chunk-V5WXEJ46.js.map
