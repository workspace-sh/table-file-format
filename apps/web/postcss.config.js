import babelConfig from "./babel.config.js";

export default {
  plugins: {
    "react-strict-dom/postcss-plugin": {
      include: [
        "src/**/*.{js,jsx,ts,tsx}",
        "../../packages/ui/src/**/*.{js,jsx,ts,tsx}",
        // table-app's views (TableEmbed) have styles of their own.
        "../../packages/app/src/**/*.{js,jsx,ts,tsx}",
      ],
      babelConfig,
    },
    autoprefixer: {},
  },
};
