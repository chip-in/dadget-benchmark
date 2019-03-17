# dadget-benchmark

##### 準備
```
$ npm i
$ npm run build
```

##### 開始コマンド例
更新テスト
```
$ npm start -- -p 10 -i 200 -t 60 -s 1
```
参照テスト
```
$ npm run start2 -- -p 10 -i 200 -t 60 -s 1 -l 100
```

-p 並列数 -i 実行間隔(ms) -t 実行時間(s) -s データサイズ(KiB) -l データ数

他の設定は src/config.js を修正して npm run build
