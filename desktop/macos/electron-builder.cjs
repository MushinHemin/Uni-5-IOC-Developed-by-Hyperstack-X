'use strict';

module.exports = {
  appId: 'com.hyperstackx.uni',
  productName: 'Uni',
  buildVersion: '50602',
  artifactName: 'Uni-${version}-${arch}.${ext}',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'build/uni-icon.svg', 'package.json'],
  asar: true,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false
  },
  mac: {
    icon: 'build/Uni.icns',
    target: 'dmg',
    category: 'public.app-category.social-networking',
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    extendInfo: {
      CFBundleShortVersionString: '5.6.0',
      CFBundleVersion: '50602',
      NSMicrophoneUsageDescription: 'Uni 在你发起或接听语音通话、录制语音消息时使用麦克风。'
    }
  },
  dmg: {
    title: 'Uni · Napa Valley',
    writeUpdateInfo: false,
    icon: 'build/Uni.icns',
    background: 'build/dmg-background.png',
    window: { width: 660, height: 430 },
    iconSize: 105,
    contents: [
      { x: 188, y: 231, type: 'file' },
      { x: 472, y: 231, type: 'link', path: '/Applications' }
    ]
  }
};
