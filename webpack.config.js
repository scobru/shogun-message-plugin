const path = require("path");

module.exports = {
  entry: "./src/index.ts",
  output: {
    path: path.resolve(__dirname, "dist/browser"),
    filename: "index.js",
    library: "ShogunMessage",
    libraryTarget: "umd",
    globalObject: "this",
  },
  resolve: {
    extensions: [".ts", ".js"],
    fallback: {
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      buffer: require.resolve("buffer"),
      util: require.resolve("util"),
      assert: require.resolve("assert"),
      http: require.resolve("stream-http"),
      https: require.resolve("https-browserify"),
      os: require.resolve("os-browserify/browser"),
      url: require.resolve("url"),
      path: require.resolve("path-browserify"),
      fs: false,
      net: false,
      tls: false,
      child_process: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  externals: {
    gun: "Gun",
  },
  plugins: [
    // Provide Buffer and process globals
    new (require("webpack").ProvidePlugin)({
      Buffer: ["buffer", "Buffer"],
      process: "process/browser",
    }),
  ],
}; 