module.exports = {
  stories: ["../src/**/*.stories.js"],

  addons: [
    "@storybook/preset-create-react-app",
    "@storybook/addon-actions",
    "@storybook/addon-links",
    "@storybook/addon-knobs",
    // "@storybook/addon-docs",
  ],

  framework: {
    name: "@storybook/react-webpack5",
    options: {},
  },

  // docs: {
  //   autodocs: true,
  // },
};
