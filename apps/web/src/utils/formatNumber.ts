// One number format on billing screens, whatever the browser's locale: an Indian browser would otherwise
// show tokens as 5,00,00,000 beside US-dollar amounts.
export const formatNumber = (n: number): string => n.toLocaleString('en-US')
