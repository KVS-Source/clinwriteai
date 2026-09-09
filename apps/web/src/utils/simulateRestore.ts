export const simulateRestore = (
  sections: string[],
  fromVersion: string,
  _reason: string
): Promise<{ newVersion: string; message: string }> =>
  new Promise(resolve =>
    setTimeout(() => resolve({
      newVersion: 'v0.5',
      message: `${sections.length} section(s) restored from ${fromVersion}. New version v0.5 created.`,
    }), 800)
  )
